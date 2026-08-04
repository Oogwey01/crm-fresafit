"use server";

import { refresh, revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { despacharPushPendientes } from "@/lib/push/enviar";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { esGestor } from "@/lib/catalogos";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import {
  archivoDeFormData,
  rutaParaArchivo,
  subirYRegistrar,
  borrarArchivoYFila,
  urlFirmada,
} from "@/lib/storage";
import { textoONulo } from "@/lib/validacion";
import type {
  AreaId,
  EstadoId,
  PrioridadId,
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

export type TaskInput = {
  titulo: string;
  descripcion: string;
  responsable_id: string | null;
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

/* ============================ Tareas ====================================== */

export async function crearTarea(input: TaskInput): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede crear tareas.");
  if ("error" in cx) return cx;

  const titulo = input.titulo.trim();
  if (!titulo) return { error: "La tarea necesita un título." };

  const { data, error } = await cx.supabase
    .from("tasks")
    .insert({
      titulo,
      descripcion: textoONulo(input.descripcion),
      responsable_id: input.responsable_id,
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

  revalidatePath("/tareas");
  empujarAvisos();
  return { ok: true };
}

export async function editarTarea(id: string, input: TaskInput): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede editar los datos de la tarea.");
  if ("error" in cx) return cx;

  const titulo = input.titulo.trim();
  if (!titulo) return { error: "La tarea necesita un título." };

  const { error } = await cx.supabase
    .from("tasks")
    .update({
      titulo,
      descripcion: textoONulo(input.descripcion),
      responsable_id: input.responsable_id,
      area: await areaDeResponsable(cx.supabase, input.responsable_id, input.area),
      prioridad: input.prioridad,
      estado: input.estado,
      fecha_limite: input.fecha_limite || null,
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

  revalidatePath("/tareas");
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
  revalidatePath("/tareas");
  empujarAvisos(); // pasar a "atorado" avisa a quien delegó
  return { ok: true };
}

/* Cambiar prioridad rápido desde una celda (meta → solo gestor). */
export async function cambiarPrioridad(id: string, prioridad: PrioridadId): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede cambiar la prioridad.");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("tasks").update({ prioridad }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

/* Reasignar responsable (meta → solo gestor). El aviso al nuevo responsable lo
   dispara el trigger `notificar_asignacion` en la BD, así que cubre también el
   arrastre entre carriles de persona y la edición desde el detalle. */
export async function reasignarTarea(id: string, responsableId: string | null): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede reasignar tareas.");
  if ("error" in cx) return cx;
  /* Al reasignar, el área sigue al nuevo responsable (si tiene perfil con área).
     Sin responsable se conserva el área actual de la tarea. */
  const patch: { responsable_id: string | null; area?: AreaId } = { responsable_id: responsableId };
  if (responsableId) {
    const { data } = await cx.supabase.from("profiles").select("area").eq("id", responsableId).single();
    const area = data?.area as AreaId | null;
    if (area) patch.area = area;
  }
  const { error } = await cx.supabase.from("tasks").update(patch).eq("id", id);
  if (error) return { error: error.message };

  /* Si quien pasa a principal venía como acompañante, se sale de la tabla: ya
     está en `responsable_id` y si no, saldría con el avatar repetido. */
  if (responsableId) {
    await cx.supabase
      .from("task_assignees")
      .delete()
      .eq("task_id", id)
      .eq("user_id", responsableId);
  }

  revalidatePath("/tareas");
  empujarAvisos();
  return { ok: true };
}

/* Cambiar el equipo de apoyo de una tarea sin tocar nada más (el selector de
   personas del detalle). El principal se administra con `reasignarTarea`. */
export async function guardarCoasignados(id: string, userIds: string[]): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede cambiar el equipo de una tarea.");
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase
    .from("tasks")
    .select("responsable_id")
    .eq("id", id)
    .single();
  if (error) return { error: error.message };

  const fallo = await sincronizarCoasignados(cx.supabase, id, userIds, data.responsable_id);
  if (fallo) return { error: fallo };

  revalidatePath("/tareas");
  empujarAvisos();
  return { ok: true };
}

/* Borrado SUAVE: manda la tarea a la papelera (se puede restaurar). */
export async function borrarTarea(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede borrar tareas.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

/* Sacar de la papelera. */
export async function restaurarTarea(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede restaurar tareas.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("tasks").update({ deleted_at: null }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

/* Eliminar DEFINITIVO (borrado real, sin vuelta atrás). */
export async function eliminarDefinitivo(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede eliminar tareas.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("tasks").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

/* Cambiar las etiquetas de una tarea (meta → gestor). */
export async function guardarEtiquetas(id: string, etiquetas: string[]): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede cambiar etiquetas.");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("tasks").update({ etiquetas }).eq("id", id);
  if (error) return { error: error.message };
  await registrarActividad(cx.supabase, id, cx.user.id, "actualizó las etiquetas");
  revalidatePath("/tareas");
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
  return {
    comentarios: c.data ?? [],
    checklist: ch.data ?? [],
    enlaces: l.data ?? [],
    adjuntos: a.data ?? [],
    actividad: act.data ?? [],
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
  revalidatePath("/tareas");
  empujarAvisos();
  return { ok: true };
}

export async function borrarComentario(id: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("task_comments").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
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
  revalidatePath("/tareas");
  return { ok: true };
}

export async function toggleChecklist(id: string, hecho: boolean): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("task_checklist").update({ hecho }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

export async function borrarChecklist(id: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("task_checklist").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
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
  revalidatePath("/tareas");
  return { ok: true };
}

export async function borrarEnlace(id: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("task_links").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
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
  revalidatePath("/tareas");
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
  revalidatePath("/tareas");
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
   metadatos de adjuntos + historial) para descargarlo como respaldo .json.
   Solo gestores: es la copia de seguridad de todo el equipo, no la vista propia.
   Los archivos binarios de Storage NO se incluyen (solo sus rutas). */
export async function exportarRespaldo(): Promise<
  { datos: Record<string, unknown> } | { error: string }
> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede descargar el respaldo completo." };

  const [tareas, perfiles, comentarios, checklist, enlaces, adjuntos, actividad] = await Promise.all([
    supabase.from("tasks").select("*").order("created_at", { ascending: true }),
    supabase.from("profiles").select("id, nombre, rol, area"),
    supabase.from("task_comments").select("*").order("created_at", { ascending: true }),
    supabase.from("task_checklist").select("*").order("orden", { ascending: true }),
    supabase.from("task_links").select("*").order("created_at", { ascending: true }),
    supabase.from("task_attachments").select("*").order("created_at", { ascending: true }),
    supabase.from("task_activity").select("*").order("created_at", { ascending: true }),
  ]);

  const conError = [tareas, perfiles, comentarios, checklist, enlaces, adjuntos, actividad].find((r) => r.error);
  if (conError?.error) return { error: conError.error.message };

  return {
    datos: {
      exportadoEl: new Date().toISOString(),
      nota: "Respaldo completo del módulo Tareas. Los archivos adjuntos no se incluyen; solo sus rutas en Storage.",
      equipo: perfiles.data ?? [],
      tareas: tareas.data ?? [],
      comentarios: comentarios.data ?? [],
      subtareas: checklist.data ?? [],
      enlaces: enlaces.data ?? [],
      adjuntos: adjuntos.data ?? [],
      actividad: actividad.data ?? [],
    },
  };
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
  revalidatePath("/tareas");
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

  // Reemplaza el conjunto de compartidos por el nuevo.
  const { error: delErr } = await supabase.from("task_shares").delete().eq("task_id", taskId);
  if (delErr) return { error: delErr.message };
  if (userIds.length) {
    const filas = userIds.map((uid) => ({ task_id: taskId, user_id: uid }));
    const { error } = await supabase.from("task_shares").insert(filas);
    if (error) return { error: error.message };
  }
  revalidatePath("/tareas");
  return { ok: true };
}
