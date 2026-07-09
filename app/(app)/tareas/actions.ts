"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { esGestor } from "@/lib/catalogos";
import type {
  AreaId,
  EstadoId,
  PrioridadId,
  TaskDetalle,
} from "@/lib/types";

export type TaskInput = {
  titulo: string;
  descripcion: string;
  responsable_id: string | null;
  area: AreaId;
  prioridad: PrioridadId;
  estado: EstadoId;
  fecha_limite: string | null;
  etiquetas: string[];
};

type Resultado = { ok: true } | { error: string };

/* Devuelve el usuario actual + su rol (para gating server-side, además de RLS). */
async function usuarioActual() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, rol: null as string | null };
  const { data: perfil } = await supabase
    .from("profiles")
    .select("rol")
    .eq("id", user.id)
    .single();
  return { supabase, user, rol: (perfil?.rol as string) ?? "miembro" };
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
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede crear tareas." };

  const titulo = input.titulo.trim();
  if (!titulo) return { error: "La tarea necesita un título." };

  const { error } = await supabase.from("tasks").insert({
    titulo,
    descripcion: input.descripcion.trim() || null,
    responsable_id: input.responsable_id,
    area: input.area,
    prioridad: input.prioridad,
    estado: input.estado,
    fecha_limite: input.fecha_limite || null,
    etiquetas: input.etiquetas ?? [],
    created_by: user.id,
  });

  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

export async function editarTarea(id: string, input: TaskInput): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede editar los datos de la tarea." };

  const titulo = input.titulo.trim();
  if (!titulo) return { error: "La tarea necesita un título." };

  const { error } = await supabase
    .from("tasks")
    .update({
      titulo,
      descripcion: input.descripcion.trim() || null,
      responsable_id: input.responsable_id,
      area: input.area,
      prioridad: input.prioridad,
      estado: input.estado,
      fecha_limite: input.fecha_limite || null,
      etiquetas: input.etiquetas ?? [],
    })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

/* Mover de estado: gestor (cualquiera) o miembro responsable (RLS + trigger lo refuerzan). */
export async function moverTarea(id: string, estado: EstadoId): Promise<Resultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ estado }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

/* Cambiar prioridad rápido desde una celda (meta → solo gestor). */
export async function cambiarPrioridad(id: string, prioridad: PrioridadId): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede cambiar la prioridad." };
  const { error } = await supabase.from("tasks").update({ prioridad }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

export async function borrarTarea(id: string): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede borrar tareas." };

  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

/* Cambiar las etiquetas de una tarea (meta → gestor). */
export async function guardarEtiquetas(id: string, etiquetas: string[]): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede cambiar etiquetas." };
  const { error } = await supabase.from("tasks").update({ etiquetas }).eq("id", id);
  if (error) return { error: error.message };
  await registrarActividad(supabase, id, user.id, "actualizó las etiquetas");
  revalidatePath("/tareas");
  return { ok: true };
}

/* ============================ Detalle (carga) ============================= */

export async function cargarDetalle(taskId: string): Promise<TaskDetalle> {
  const supabase = await createClient();
  const [c, ch, l, a, act] = await Promise.all([
    supabase.from("task_comments").select("*").eq("task_id", taskId).order("created_at", { ascending: true }),
    supabase.from("task_checklist").select("*").eq("task_id", taskId).order("orden", { ascending: true }),
    supabase.from("task_links").select("*").eq("task_id", taskId).order("created_at", { ascending: true }),
    supabase.from("task_attachments").select("*").eq("task_id", taskId).order("created_at", { ascending: true }),
    supabase.from("task_activity").select("*").eq("task_id", taskId).order("created_at", { ascending: false }),
  ]);
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
  const { supabase, user } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  const t = texto.trim();
  if (!t) return { error: "El comentario está vacío." };
  const { error } = await supabase.from("task_comments").insert({ task_id: taskId, autor: user.id, texto: t });
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

export async function borrarComentario(id: string): Promise<Resultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("task_comments").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

/* ============================ Checklist =================================== */

export async function agregarChecklist(taskId: string, texto: string): Promise<Resultado> {
  const { supabase, user } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  const t = texto.trim();
  if (!t) return { error: "La subtarea está vacía." };
  const { error } = await supabase.from("task_checklist").insert({ task_id: taskId, texto: t });
  if (error) return { error: error.message };
  await registrarActividad(supabase, taskId, user.id, `agregó la subtarea «${t}»`);
  revalidatePath("/tareas");
  return { ok: true };
}

export async function toggleChecklist(id: string, hecho: boolean): Promise<Resultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("task_checklist").update({ hecho }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

export async function borrarChecklist(id: string): Promise<Resultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("task_checklist").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

/* ============================ Enlaces ===================================== */

export async function agregarEnlace(taskId: string, titulo: string, url: string): Promise<Resultado> {
  const { supabase, user } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  const u = url.trim();
  if (!u) return { error: "Falta la URL." };
  const { error } = await supabase.from("task_links").insert({ task_id: taskId, titulo: titulo.trim() || null, url: u });
  if (error) return { error: error.message };
  await registrarActividad(supabase, taskId, user.id, "agregó un enlace");
  revalidatePath("/tareas");
  return { ok: true };
}

export async function borrarEnlace(id: string): Promise<Resultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("task_links").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

/* ============================ Adjuntos (Storage) ========================== */

export async function subirAdjunto(taskId: string, formData: FormData): Promise<Resultado> {
  const { supabase, user } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No se recibió el archivo." };
  if (file.size > 10 * 1024 * 1024) return { error: "El archivo supera 10 MB." };

  const limpio = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${taskId}/${Date.now()}-${limpio}`;

  const { error: upErr } = await supabase.storage.from("adjuntos").upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (upErr) return { error: upErr.message };

  const { error } = await supabase.from("task_attachments").insert({
    task_id: taskId,
    autor: user.id,
    nombre: file.name,
    storage_path: path,
    tipo: file.type || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

export async function borrarAdjunto(id: string, storagePath: string): Promise<Resultado> {
  const supabase = await createClient();
  await supabase.storage.from("adjuntos").remove([storagePath]);
  const { error } = await supabase.from("task_attachments").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tareas");
  return { ok: true };
}

/* Genera una URL firmada temporal para ver/descargar un adjunto. */
export async function urlAdjunto(storagePath: string): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("adjuntos").createSignedUrl(storagePath, 60 * 60);
  if (error || !data) return { error: error?.message ?? "No se pudo generar el enlace." };
  return { url: data.signedUrl };
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
