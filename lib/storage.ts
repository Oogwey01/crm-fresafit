import type { SupabaseClient } from "@supabase/supabase-js";

/* Helpers de Storage compartidos por finanzas (comprobantes), inventario
   (fotos, comprobantes de pago) y tareas (adjuntos). Reúnen el mismo trío que
   cada módulo tenía copiado: validar el File del FormData, subir con ruta
   limpia + registrar la fila (deshaciendo el binario si el insert falla),
   y firmar URLs temporales. */

const MAX_MB_DEFAULT = 10;

/* Saca y valida el archivo de un FormData (campo "file"). */
export function archivoDeFormData(
  formData: FormData,
  opts: { maxMB?: number; soloImagenes?: boolean; mensajeExcedido?: string } = {},
): { file: File } | { error: string } {
  const maxMB = opts.maxMB ?? MAX_MB_DEFAULT;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No se recibió el archivo." };
  if (opts.soloImagenes && !file.type.startsWith("image/")) {
    return { error: "El archivo debe ser una imagen." };
  }
  if (file.size > maxMB * 1024 * 1024) {
    return { error: opts.mensajeExcedido ?? `El archivo supera ${maxMB} MB.` };
  }
  return { file };
}

/* Ruta única y sin caracteres raros: `<prefijo>/<timestamp>-<nombre_limpio>`. */
export function rutaParaArchivo(prefijo: string, nombre: string): string {
  const limpio = nombre.replace(/[^\w.\-]+/g, "_");
  return `${prefijo}/${Date.now()}-${limpio}`;
}

/* Sube el binario y luego registra su fila; si el insert falla, borra el
   binario para no dejar basura huérfana en Storage. */
export async function subirYRegistrar<T>(args: {
  supabase: SupabaseClient;
  bucket: string;
  path: string;
  file: File;
  insertar: () => PromiseLike<{ data: T | null; error: { message: string } | null }>;
  errorRegistro: string;
}): Promise<{ ok: true; datos: T } | { error: string }> {
  const { supabase, bucket, path, file } = args;
  const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (upErr) return { error: upErr.message };

  const { data, error } = await args.insertar();
  if (error || !data) {
    await supabase.storage.from(bucket).remove([path]);
    return { error: error?.message ?? args.errorRegistro };
  }
  return { ok: true, datos: data };
}

/* Borra el binario y después su fila de registro. */
export async function borrarArchivoYFila(args: {
  supabase: SupabaseClient;
  bucket: string;
  path: string;
  tabla: string;
  id: string;
}): Promise<{ ok: true } | { error: string }> {
  const { supabase, bucket, path, tabla, id } = args;
  await supabase.storage.from(bucket).remove([path]);
  const { error } = await supabase.from(tabla).delete().eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

/* URL firmada temporal (1 h) para ver o descargar un archivo privado. */
export async function urlFirmada(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<{ url: string } | { error: string }> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  if (error || !data) return { error: error?.message ?? "No se pudo generar el enlace." };
  return { url: data.signedUrl };
}
