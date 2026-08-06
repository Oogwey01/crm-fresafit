"use server";

/* Acciones de detalle, comentarios, subtareas y enlaces (Tareas). Ver el barril en ../actions.ts. */

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import {
  urlesFirmadas,
} from "@/lib/storage";
import { textoONulo } from "@/lib/validacion";
import { esImagenAdjunto } from "@/lib/tareas/reglas";
import type {
  TaskAttachment,
  TaskDetalle,
} from "@/lib/types";
import {
  empujarAvisos,
  registrarActividad,
  revalidarTareas,
} from "@/app/(app)/tareas/acciones/comun";

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
