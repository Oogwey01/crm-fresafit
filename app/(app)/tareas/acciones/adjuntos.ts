"use server";

/* Acciones de adjuntos en Storage (Tareas). Ver el barril en ../actions.ts. */

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import {
  archivoDeFormData,
  rutaParaArchivo,
  subirYRegistrar,
  borrarArchivoYFila,
  urlFirmada,
} from "@/lib/storage";
import {
  revalidarTareas,
} from "@/app/(app)/tareas/acciones/comun";

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
