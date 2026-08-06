/* Lo que comparten las familias de acciones de Tareas: el portero de permisos,
   la sincronización de coasignados, el empujón de avisos y el tipo de entrada
   del formulario. Vive aparte y SIN "use server" porque un módulo de acciones
   solo puede exportar funciones async: ni el tipo ni las constantes caben ahí.

   Salió del actions.ts único de 858 líneas, que mezclaba nueve familias
   —tareas, detalle, comentarios, subtareas, enlaces, adjuntos, respaldo,
   notificaciones y compartir— con este preámbulo común. */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { despacharPushPendientes } from "@/lib/push/enviar";
import { esGestor } from "@/lib/catalogos";
import { exigirRol, type ContextoRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import type {
  AreaId,
  EspacioId,
  EstadoId,
  PrioridadId,
} from "@/lib/types";

/* Los avisos los insertan TRIGGERS de Postgres (asignación, comentario), que no
   pueden hablar con los servidores de push. Esta llamada barre lo pendiente y lo
   empuja a los dispositivos.

   Va en `after` para que no retrase la respuesta: quien comenta ya vio su
   comentario publicado mientras el aviso sale por detrás. Si el barrido falla,
   el cron de recordatorios lo recoge en la siguiente pasada. */
export function empujarAvisos() {
  after(async () => {
    await despacharPushPendientes();
  });
}

/* Los dos tableros (Fresafit y Agencia) comparten estos actions, así que cada
   cambio tiene que refrescar ambos: una tarea puede cambiar de cliente y aparecer
   en el otro listado, y el badge del menú cuenta por espacio. */
const RUTAS_TAREAS = ["/tareas", "/agencia/tareas"];
export const revalidarTareas = () => RUTAS_TAREAS.forEach((r) => revalidatePath(r));

export type TaskInput = {
  titulo: string;
  descripcion: string;
  responsable_id: string | null;
  /* De qué negocio nace la tarea. Lo fija el tablero donde se creó; sin definir,
     Fresafit (que es lo que había antes de partir los tableros). */
  espacio?: EspacioId;
  /* Cliente de la agencia. Solo aplica en el espacio "agencia": en Fresafit se
     ignora, porque la marca no tiene cliente que pida el trabajo. */
  empresa_id?: string | null;
  /* Las DEMÁS personas que trabajan la tarea (tabla task_assignees). El
     responsable principal no va aquí: es quien manda en el área y en el carril
     del tablero. Sin definir = no se toca el equipo actual. */
  coasignados?: string[];
  area: AreaId;
  prioridad: PrioridadId;
  estado: EstadoId;
  fecha_limite: string | null;
  recordatorio_at: string | null;
  /* Motivo cuando la tarea se guarda como "atorado" (se ignora en otros estados). */
  motivo_atorado?: string | null;
  etiquetas: string[];
};

/* Deja `task_assignees` exactamente con la lista pedida: agrega los que faltan
   y quita los que sobran, sin borrar y reinsertar a todos (eso dispararía otra
   vez el aviso "Te sumaron a…" para quien ya estaba).

   El principal nunca se guarda como coasignado: ya está en `responsable_id` y
   duplicarlo pintaría su avatar dos veces. Si la tabla todavía no existe (la
   migración se aplica a mano) se devuelve el error para que la acción lo
   reporte en vez de guardar a medias. */
export async function sincronizarCoasignados(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: string,
  deseados: string[] | undefined,
  responsableId: string | null,
): Promise<string | null> {
  if (!deseados) return null;

  const querer = new Set(deseados.filter((id) => id && id !== responsableId));

  const { data, error } = await supabase
    .from("task_assignees")
    .select("user_id")
    .eq("task_id", taskId);
  if (error) return error.message;

  const actuales = new Set(((data ?? []) as { user_id: string }[]).map((f) => f.user_id));

  const agregar = [...querer].filter((id) => !actuales.has(id));
  const quitar = [...actuales].filter((id) => !querer.has(id));

  if (agregar.length) {
    const { error: e } = await supabase
      .from("task_assignees")
      .insert(agregar.map((user_id) => ({ task_id: taskId, user_id })));
    if (e) return e.message;
  }
  if (quitar.length) {
    const { error: e } = await supabase
      .from("task_assignees")
      .delete()
      .eq("task_id", taskId)
      .in("user_id", quitar);
    if (e) return e.message;
  }
  return null;
}

/* El área de una tarea sigue a su responsable: si se asigna a alguien, se toma
   el área de su perfil (lo pidió Armando en la junta). Sin responsable —o si su
   perfil no tiene área— se conserva la que venga en el formulario. */
export async function areaDeResponsable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  responsableId: string | null,
  fallback: AreaId,
): Promise<AreaId> {
  if (!responsableId) return fallback;
  const { data } = await supabase.from("profiles").select("area").eq("id", responsableId).single();
  return ((data?.area as AreaId | null) ?? fallback);
}

/* El motivo solo aplica cuando la tarea queda "atorado"; en cualquier otro estado
   se limpia. */
export function motivoParaEstado(estado: EstadoId, motivo: string | null | undefined): string | null {
  return estado === "atorado" ? textoONulo(motivo) : null;
}

/* Portero de lo que cambia la tarea en sí (su meta, su prioridad, la papelera):
   manda un gestor —que manda en todo el tablero— o quien la creó, que manda
   sobre la suya. Desde que cualquiera del equipo puede abrir tareas, exigir
   gestor aquí dejaba a la gente sin poder corregir ni borrar lo que ella misma
   puso.

   La BD aplica exactamente lo mismo (policy "tareas: editar" + el trigger
   `restringir_update_tarea`); esto es defensa en profundidad y, sobre todo, el
   mensaje con palabras que ve la persona en vez de un error de RLS. */
export async function exigirMandoTarea(id: string, mensaje: string): Promise<ContextoRol> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  if (esGestor(cx.rol)) return cx;

  const { data, error } = await cx.supabase
    .from("tasks")
    .select("created_by")
    .eq("id", id)
    .single();
  if (error) return { error: error.message };
  if (data?.created_by !== cx.user.id) return { error: mensaje };
  return cx;
}

/* Registra una línea en el historial de actividad de la tarea.
   Los cambios de estado / comentarios / adjuntos ya los registran triggers en la BD;
   esto cubre los que NO tienen trigger (checklist, enlaces, etiquetas). Es informativo:
   si el insert falla (p. ej. RLS), NO rompe la acción principal. La policy
   "actividad: registrar" (20250102000003_rls.sql) permite insertar si puedes ver la tarea. */
export async function registrarActividad(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: string,
  autor: string,
  texto: string,
): Promise<void> {
  await supabase.from("task_activity").insert({ task_id: taskId, autor, texto });
}

/* El cliente solo existe en la agencia: en Fresafit se descarta aunque venga en
   el formulario. La BD tiene la misma regla (`tasks_empresa_solo_agencia`), pero
   aquí se limpia antes para no chocar contra el check con un error feo. */
export function empresaParaEspacio(
  espacio: EspacioId,
  empresaId: string | null | undefined,
): string | null {
  return espacio === "agencia" ? (empresaId || null) : null;
}
