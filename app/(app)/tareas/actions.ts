"use server";

import { refresh, revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { despacharPushPendientes } from "@/lib/push/enviar";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { traerTodo } from "@/lib/canales/paginacion";
import { esGestor } from "@/lib/catalogos";
import type { Resultado } from "@/lib/acciones";
import { exigirRol, type ContextoRol } from "@/lib/supabase/guardia";
import {
  archivoDeFormData,
  rutaParaArchivo,
  subirYRegistrar,
  borrarArchivoYFila,
  urlFirmada,
  urlesFirmadas,
} from "@/lib/storage";
import { textoONulo } from "@/lib/validacion";
import { esImagenAdjunto } from "@/lib/types";
import type {
  AreaId,
  EspacioId,
  EstadoId,
  PrioridadId,
  TaskAttachment,
  TaskDetalle,
} from "@/lib/types";

/* Los avisos los insertan TRIGGERS de Postgres (asignación, comentario), que no
   pueden hablar con los servidores de push. Esta llamada barre lo pendiente y lo
   empuja a los dispositivos.

   Va en `after` para que no retrase la respuesta: quien comenta ya vio su
   comentario publicado mientras el aviso sale por detrás. Si el barrido falla,
   el cron de recordatorios lo recoge en la siguiente pasada. */
function empujarAvisos() {
  after(async () => {
    await despacharPushPendientes();
  });
}

/* Los dos tableros (Fresafit y Agencia) comparten estos actions, así que cada
   cambio tiene que refrescar ambos: una tarea puede cambiar de cliente y aparecer
   en el otro listado, y el badge del menú cuenta por espacio. */
const RUTAS_TAREAS = ["/tareas", "/agencia/tareas"];
const revalidarTareas = () => RUTAS_TAREAS.forEach((r) => revalidatePath(r));

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
async function sincronizarCoasignados(
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
async function areaDeResponsable(
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
function motivoParaEstado(estado: EstadoId, motivo: string | null | undefined): string | null {
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
async function exigirMandoTarea(id: string, mensaje: string): Promise<ContextoRol> {
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
async function registrarActividad(
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
function empresaParaEspacio(
  espacio: EspacioId,
  empresaId: string | null | undefined,
): string | null {
  return espacio === "agencia" ? (empresaId || null) : null;
}

/* ============================ Tareas ====================================== */

/* Crear tarea: TODO el equipo de casa, no solo quien coordina. Un miembro abre
   sus propios pendientes —que antes vivían en una libreta— y puede asignárselos
   a quien toque; el aviso al responsable lo dispara `notificar_asignacion`.
   `externo` queda fuera: ese rol solo ve lo que se le comparte.

   OJO con el `.select("id")` de aquí abajo: hace que el alta sea un
   INSERT … RETURNING, y en una tabla con RLS eso pasa TAMBIÉN por la política
   de lectura, aplicada a la fila recién nacida. Si esa política sale a buscar
   la fila en vez de mirar sus columnas, no la encuentra —no está en el
   snapshot de la sentencia— y el alta falla con un error que parece de
   permisos de escritura. Ya pasó una vez; lo cuenta entero
   20260907000000_ver_tareas_por_columna.sql. El id se necesita para sumar a los
   acompañantes, así que el RETURNING se queda. */
export async function crearTarea(input: TaskInput): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo de Fresafit puede crear tareas.");
  if ("error" in cx) return cx;

  const titulo = input.titulo.trim();
  if (!titulo) return { error: "La tarea necesita un título." };

  const { data, error } = await cx.supabase
    .from("tasks")
    .insert({
      titulo,
      descripcion: textoONulo(input.descripcion),
      responsable_id: input.responsable_id,
      espacio: input.espacio ?? "fresafit",
      empresa_id: empresaParaEspacio(input.espacio ?? "fresafit", input.empresa_id),
      area: await areaDeResponsable(cx.supabase, input.responsable_id, input.area),
      prioridad: input.prioridad,
      estado: input.estado,
      fecha_limite: input.fecha_limite || null,
      recordatorio_at: input.recordatorio_at || null,
      motivo_atorado: motivoParaEstado(input.estado, input.motivo_atorado),
      etiquetas: input.etiquetas ?? [],
      created_by: cx.user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  const falloEquipo = await sincronizarCoasignados(
    cx.supabase,
    data.id,
    input.coasignados,
    input.responsable_id,
  );
  if (falloEquipo) return { error: `La tarea se creó, pero no se pudo sumar al equipo: ${falloEquipo}` };

  revalidarTareas();
  empujarAvisos();
  return { ok: true };
}

export async function editarTarea(id: string, input: TaskInput): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede editar sus datos.",
  );
  if ("error" in cx) return cx;

  const titulo = input.titulo.trim();
  if (!titulo) return { error: "La tarea necesita un título." };

  /* El espacio NO se edita: una tarea nace en el tablero donde se creó. El
     cliente sí, y solo se toca si el formulario lo mandó (el de Fresafit no lo
     tiene y no debe borrar el que ya trae la tarea). */
  const cliente =
    input.espacio === "agencia" && input.empresa_id !== undefined
      ? { empresa_id: input.empresa_id || null }
      : {};

  const { error } = await cx.supabase
    .from("tasks")
    .update({
      titulo,
      descripcion: textoONulo(input.descripcion),
      responsable_id: input.responsable_id,
      ...cliente,
      area: await areaDeResponsable(cx.supabase, input.responsable_id, input.area),
      prioridad: input.prioridad,
      estado: input.estado,
      fecha_limite: input.fecha_limite || null,
      /* Reprogramarlo lo vuelve a armar solo: el trigger
         `tasks_rearmar_recordatorio` pone `recordatorio_enviado` en false
         cuando la fecha cambia (20260728000000_tareas_org_notificaciones.sql). */
      recordatorio_at: input.recordatorio_at || null,
      motivo_atorado: motivoParaEstado(input.estado, input.motivo_atorado),
      etiquetas: input.etiquetas ?? [],
    })
    .eq("id", id);

  if (error) return { error: error.message };

  const falloEquipo = await sincronizarCoasignados(
    cx.supabase,
    id,
    input.coasignados,
    input.responsable_id,
  );
  if (falloEquipo) return { error: `Se guardó la tarea, pero no el equipo: ${falloEquipo}` };

  revalidarTareas();
  empujarAvisos(); // editar puede cambiar el responsable o sumar gente
  return { ok: true };
}

/* Mover de estado: gestor (cualquiera) o miembro responsable (RLS + trigger lo
   refuerzan). Al pasar a "atorado" se guarda el motivo (qué se necesita de
   vuelta); al salir de "atorado" el motivo se limpia. El aviso a quien delegó lo
   dispara el trigger `notificar_atorado` en la BD. */
export async function moverTarea(
  id: string,
  estado: EstadoId,
  motivoAtorado?: string | null,
): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase
    .from("tasks")
    .update({ estado, motivo_atorado: motivoParaEstado(estado, motivoAtorado) })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  empujarAvisos(); // pasar a "atorado" avisa a quien delegó
  return { ok: true };
}

/* Cambiar prioridad rápido desde una celda (gestor o quien creó la tarea). */
export async function cambiarPrioridad(id: string, prioridad: PrioridadId): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede cambiar su prioridad.",
  );
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("tasks").update({ prioridad }).eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true };
}

/* Reasignar responsable (gestor o quien creó la tarea). El aviso al nuevo
   responsable lo dispara el trigger `notificar_asignacion` en la BD, así que
   cubre también el arrastre entre carriles de persona y la edición desde el
   detalle. */
export async function reasignarTarea(id: string, responsableId: string | null): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede reasignarla.",
  );
  if ("error" in cx) return cx;
  /* Al reasignar, el área sigue al nuevo responsable (si tiene perfil con área).
     Sin responsable se conserva el área actual de la tarea. */
  const patch: { responsable_id: string | null; area?: AreaId } = { responsable_id: responsableId };
  if (responsableId) {
    const { data } = await cx.supabase.from("profiles").select("area").eq("id", responsableId).single();
    const area = data?.area as AreaId | null;
    if (area) patch.area = area;
  }
  /* El update de la tarea y la salida del acompañante no dependen entre sí:
     juntos en un solo viaje de pared.

     Lo segundo es porque quien pasa a principal, si venía como acompañante, ya
     está en `responsable_id`: dejarlo en la tabla le repetiría el avatar. */
  const [actualizada] = await Promise.all([
    cx.supabase.from("tasks").update(patch).eq("id", id),
    responsableId
      ? cx.supabase.from("task_assignees").delete().eq("task_id", id).eq("user_id", responsableId)
      : Promise.resolve(null),
  ]);
  if (actualizada.error) return { error: actualizada.error.message };

  revalidarTareas();
  empujarAvisos();
  return { ok: true };
}

/* Mover una tarea de la agencia a otro cliente (arrastre entre carriles del
   tablero por cliente, o el selector del detalle). `null` = trabajo de la propia
   agencia. Solo aplica en el espacio "agencia": la BD rechaza ponerle cliente a
   una tarea de Fresafit, y aquí se avisa con palabras en vez de con un error de
   constraint. */
export async function reasignarEmpresa(
  id: string,
  empresaId: string | null,
): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede cambiarla de cliente.",
  );
  if ("error" in cx) return cx;

  const { data, error: errLeer } = await cx.supabase
    .from("tasks")
    .select("espacio")
    .eq("id", id)
    .single();
  if (errLeer) return { error: errLeer.message };
  if (data.espacio !== "agencia") {
    return { error: "Solo las tareas de la Agencia pertenecen a un cliente." };
  }

  const { error } = await cx.supabase
    .from("tasks")
    .update({ empresa_id: empresaId })
    .eq("id", id);
  if (error) return { error: error.message };

  await registrarActividad(
    cx.supabase,
    id,
    cx.user.id,
    empresaId ? "cambió la tarea de cliente" : "quitó el cliente de la tarea",
  );
  revalidarTareas();
  return { ok: true };
}

/* Cambiar el equipo de apoyo de una tarea sin tocar nada más (el selector de
   personas del detalle). El principal se administra con `reasignarTarea`. */
export async function guardarCoasignados(id: string, userIds: string[]): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede cambiar su equipo.",
  );
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase
    .from("tasks")
    .select("responsable_id")
    .eq("id", id)
    .single();
  if (error) return { error: error.message };

  const fallo = await sincronizarCoasignados(cx.supabase, id, userIds, data.responsable_id);
  if (fallo) return { error: fallo };

  revalidarTareas();
  empujarAvisos();
  return { ok: true };
}

/* Borrado SUAVE: manda la tarea a la papelera (se puede restaurar).
   Gestor o quien la creó: lo que uno abre por error, uno lo puede tirar. */
export async function borrarTarea(id: string): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede borrarla.",
  );
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true };
}

/* Sacar de la papelera. */
export async function restaurarTarea(id: string): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede restaurarla.",
  );
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("tasks").update({ deleted_at: null }).eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true };
}

/* Eliminar DEFINITIVO (borrado real, sin vuelta atrás). */
export async function eliminarDefinitivo(id: string): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede eliminarla.",
  );
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("tasks").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true };
}

/* Cambiar las etiquetas de una tarea (gestor o quien la creó). */
export async function guardarEtiquetas(id: string, etiquetas: string[]): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede cambiar sus etiquetas.",
  );
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("tasks").update({ etiquetas }).eq("id", id);
  if (error) return { error: error.message };
  await registrarActividad(cx.supabase, id, cx.user.id, "actualizó las etiquetas");
  revalidarTareas();
  return { ok: true };
}

/* ============================ Detalle (carga) ============================= */

/* Lanza si alguna de las cinco consultas falla: antes un error de RLS o de red
   se devolvía como listas vacías y la tarea se veía "sin comentarios" en vez de
   avisar que no se pudo leer. */
export async function cargarDetalle(taskId: string): Promise<TaskDetalle> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) throw new Error(cx.error);
  const [c, ch, l, a, act] = await Promise.all([
    cx.supabase.from("task_comments").select("*").eq("task_id", taskId).order("created_at", { ascending: true }),
    cx.supabase.from("task_checklist").select("*").eq("task_id", taskId).order("orden", { ascending: true }),
    cx.supabase.from("task_links").select("*").eq("task_id", taskId).order("created_at", { ascending: true }),
    cx.supabase.from("task_attachments").select("*").eq("task_id", taskId).order("created_at", { ascending: true }),
    cx.supabase.from("task_activity").select("*").eq("task_id", taskId).order("created_at", { ascending: false }),
  ]);
  const fallo = [c, ch, l, a, act].find((r) => r.error);
  if (fallo?.error) throw new Error(fallo.error.message);

  /* Las fotos se ven DENTRO de la tarea, no se descargan una por una: el bucket
     es privado, así que aquí se firma una miniatura por cada adjunto que sea
     imagen. Van redimensionadas a una caja de 320 (el doble de lo que miden en
     pantalla, para que se vean nítidas en retina): las fotos del celular pesan
     varios MB y una tarea con cinco sería una descarga absurda para un
     recuadro. La original se sigue pidiendo aparte, solo al ampliar una. */
  const adjuntos = (a.data ?? []) as TaskAttachment[];
  const miniaturas = await urlesFirmadas(
    cx.supabase,
    "adjuntos",
    adjuntos.filter(esImagenAdjunto).map((x) => x.storage_path),
    { ancho: 320, alto: 320 },
  );

  return {
    comentarios: c.data ?? [],
    checklist: ch.data ?? [],
    enlaces: l.data ?? [],
    adjuntos,
    actividad: act.data ?? [],
    miniaturas,
  };
}

/* ============================ Comentarios ================================= */

export async function comentar(taskId: string, texto: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const t = texto.trim();
  if (!t) return { error: "El comentario está vacío." };
  const { error } = await cx.supabase.from("task_comments").insert({ task_id: taskId, autor: cx.user.id, texto: t });
  if (error) return { error: error.message };
  revalidarTareas();
  empujarAvisos();
  return { ok: true };
}

export async function borrarComentario(id: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("task_comments").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true };
}

/* ============================ Checklist =================================== */

export async function agregarChecklist(taskId: string, texto: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const t = texto.trim();
  if (!t) return { error: "La subtarea está vacía." };
  const { error } = await cx.supabase.from("task_checklist").insert({ task_id: taskId, texto: t });
  if (error) return { error: error.message };
  await registrarActividad(cx.supabase, taskId, cx.user.id, `agregó la subtarea «${t}»`);
  revalidarTareas();
  return { ok: true };
}

export async function toggleChecklist(id: string, hecho: boolean): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("task_checklist").update({ hecho }).eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true };
}

export async function borrarChecklist(id: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("task_checklist").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true };
}

/* ============================ Enlaces ===================================== */

export async function agregarEnlace(taskId: string, titulo: string, url: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const u = url.trim();
  if (!u) return { error: "Falta la URL." };
  const { error } = await cx.supabase.from("task_links").insert({ task_id: taskId, titulo: textoONulo(titulo), url: u });
  if (error) return { error: error.message };
  await registrarActividad(cx.supabase, taskId, cx.user.id, "agregó un enlace");
  revalidarTareas();
  return { ok: true };
}

export async function borrarEnlace(id: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("task_links").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true };
}

/* ============================ Adjuntos (Storage) ========================== */

export async function subirAdjunto(taskId: string, formData: FormData): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const archivo = archivoDeFormData(formData);
  if ("error" in archivo) return archivo;
  const { file } = archivo;
  const path = rutaParaArchivo(taskId, file.name);

  /* Con rollback del binario si el registro falla: antes el adjunto quedaba
     huérfano en Storage (los otros tres puntos de subida sí lo limpiaban). */
  const r = await subirYRegistrar({
    supabase: cx.supabase,
    bucket: "adjuntos",
    path,
    file,
    insertar: () =>
      cx.supabase
        .from("task_attachments")
        .insert({
          task_id: taskId,
          autor: cx.user.id,
          nombre: file.name,
          storage_path: path,
          tipo: file.type || null,
        })
        .select("id")
        .single(),
    errorRegistro: "No se pudo registrar el adjunto.",
  });
  if ("error" in r) return r;
  revalidarTareas();
  return { ok: true };
}

export async function borrarAdjunto(id: string, storagePath: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const r = await borrarArchivoYFila({
    supabase: cx.supabase,
    bucket: "adjuntos",
    path: storagePath,
    tabla: "task_attachments",
    id,
  });
  if ("error" in r) return r;
  revalidarTareas();
  return { ok: true };
}

/* Genera una URL firmada temporal para ver/descargar un adjunto. */
export async function urlAdjunto(storagePath: string): Promise<{ url: string } | { error: string }> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  return urlFirmada(cx.supabase, "adjuntos", storagePath);
}

/* ============================ Respaldo completo =========================== */

/* Trae TODO el módulo de tareas (tareas + comentarios + subtareas + enlaces +
   metadatos de adjuntos + historial + quién trabaja y con quién se compartió)
   para descargarlo como respaldo .json.
   Solo gestores: es la copia de seguridad de todo el equipo, no la vista propia.
   Los archivos binarios de Storage NO se incluyen (solo sus rutas).

   TODAS las tablas se traen paginadas con `traerTodo`. Antes iban con un
   `select` a secas, que parecía traerlo todo pero no: PostgREST corta en 1000
   filas SIN devolver error, así que el archivo que el equipo se descargaba
   creyendo que era su copia de seguridad venía mutilado —comentarios y bitácora
   pasaron de mil hace tiempo— y nada en pantalla lo delataba. Un respaldo que
   miente es peor que no tener respaldo, porque nadie va a buscar el original.

   `task_assignees` y `task_shares` se agregaron por lo mismo: quién más trabaja
   la tarea y con quién se compartió solo viven ahí, y sin ellas el respaldo no
   alcanzaba para reconstruir el módulo. `task_reads` se deja fuera a propósito:
   es la marca de "ya lo vi" de cada persona, se regenera sola con el uso y
   restaurarla no devuelve nada de trabajo perdido. */
export async function exportarRespaldo(): Promise<
  { datos: Record<string, unknown> } | { error: string }
> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede descargar el respaldo completo." };

  type Fila = Record<string, unknown>;
  try {
    /* El orden lleva `id` de desempate a propósito: paginar por rangos exige un
       criterio ÚNICO, y `created_at` no lo es (una importación en lote guarda
       decenas de filas con el mismo instante). Sin el desempate, dos tandas
       podían repetir una fila y saltarse otra. */
    /* Aquí el `*` es a propósito y NO hay que cambiarlo por COLUMNAS_TAREA:
       esto es la copia de seguridad, y tiene que llevarse cualquier columna
       que se agregue en el futuro sin que nadie se acuerde de venir a
       apuntarla. Es justo lo contrario del criterio de las pantallas. */
    const [tareas, perfiles, comentarios, checklist, enlaces, adjuntos, actividad, equipoTarea, compartidas] =
      await Promise.all([
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("tasks").select("*").order("created_at").order("id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("profiles").select("id, nombre, rol, area").order("id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_comments").select("*").order("created_at").order("id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_checklist").select("*").order("created_at").order("id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_links").select("*").order("created_at").order("id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_attachments").select("*").order("created_at").order("id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_activity").select("*").order("created_at").order("id").range(desde, hasta),
        ),
        /* Tablas puente: no tienen `id`, su llave es el par (tarea, persona). */
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_assignees").select("*").order("task_id").order("user_id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_shares").select("*").order("task_id").order("user_id").range(desde, hasta),
        ),
      ]);

    return {
      datos: {
        exportadoEl: new Date().toISOString(),
        /* La nota dice exactamente qué hay y qué no: es el papelito que va a
           leer quien abra este archivo dentro de un año para saber si le sirve. */
        nota:
          "Respaldo completo del módulo Tareas: tareas (incluidas las de la papelera)," +
          " comentarios, subtareas, enlaces, historial, el equipo de cada tarea y con quién" +
          " se compartió. Todas las tablas van íntegras, sin recorte. No incluye los archivos" +
          " adjuntos —solo sus rutas en Storage— ni las marcas de 'ya lo vi' de cada persona," +
          " que se regeneran solas con el uso.",
        equipo: perfiles,
        tareas,
        comentarios,
        subtareas: checklist,
        enlaces,
        adjuntos,
        actividad,
        coasignados: equipoTarea,
        compartidas,
      },
    };
  } catch (e) {
    /* `traerTodo` lanza en cuanto una tanda falla, y hace bien: mejor no
       entregar respaldo que entregar uno a medias sin decirlo. */
    return { error: e instanceof Error ? e.message : "No se pudo armar el respaldo." };
  }
}

/* ============================ Importar en lote ============================= */

/* Alta masiva de tareas (pegar texto → filas). Solo gestor. Reusa el insert de
   `crearTarea`; cada fila con responsable dispara el aviso vía trigger. */
export async function importarTareas(
  filas: TaskInput[],
): Promise<{ ok: true; creadas: number } | { error: string }> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede importar tareas.");
  if ("error" in cx) return cx;

  const validas = filas
    .map((f) => ({ ...f, titulo: f.titulo.trim() }))
    .filter((f) => f.titulo);
  if (!validas.length) return { error: "No hay renglones con título para importar." };

  const { error } = await cx.supabase.from("tasks").insert(
    validas.map((f) => ({
      titulo: f.titulo,
      descripcion: textoONulo(f.descripcion),
      responsable_id: f.responsable_id,
      espacio: f.espacio ?? "fresafit",
      empresa_id: empresaParaEspacio(f.espacio ?? "fresafit", f.empresa_id),
      area: f.area,
      prioridad: f.prioridad,
      estado: f.estado,
      fecha_limite: f.fecha_limite || null,
      recordatorio_at: f.recordatorio_at || null,
      etiquetas: f.etiquetas ?? [],
      created_by: cx.user.id,
    })),
  );
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true, creadas: validas.length };
}

/* ============================ Notificaciones ============================== */

export async function marcarNotificacionLeida(id: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("notifications").update({ leida: true }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}

export async function marcarTodasLeidas(): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase
    .from("notifications")
    .update({ leida: true })
    .eq("user_id", cx.user.id)
    .eq("leida", false);
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}

/* Marca la tarea como vista POR MÍ: es lo que apaga el punto de "hay algo
   nuevo". `ultima_actividad_at` es global a la tarea, así que la lectura tiene
   que ser por persona (tabla task_reads). */
export async function marcarTareaLeida(taskId: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase
    .from("task_reads")
    .upsert(
      { task_id: taskId, user_id: cx.user.id, leido_at: new Date().toISOString() },
      { onConflict: "task_id,user_id" },
    );
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}

/* ============================ Compartir (externo) ========================= */

export async function compartirTarea(taskId: string, userIds: string[]): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede compartir tareas." };

  /* Reemplaza el conjunto de compartidos por el nuevo, insertando ANTES de
     podar. Al revés —borrar todo y luego insertar— un fallo entre las dos
     sentencias dejaba la tarea sin ningún compartido, que es pérdida de datos;
     así lo peor que puede pasar es que sobre alguien, que se ve y se corrige.
     El upsert absorbe a quien ya estaba (la llave es el par tarea+persona). */
  if (userIds.length) {
    const filas = userIds.map((uid) => ({ task_id: taskId, user_id: uid }));
    const { error } = await supabase
      .from("task_shares")
      .upsert(filas, { onConflict: "task_id,user_id" });
    if (error) return { error: error.message };
  }

  let poda = supabase.from("task_shares").delete().eq("task_id", taskId);
  if (userIds.length) poda = poda.not("user_id", "in", `(${userIds.join(",")})`);
  const { error: delErr } = await poda;
  if (delErr) return { error: delErr.message };

  revalidarTareas();
  return { ok: true };
}
