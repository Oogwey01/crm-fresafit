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

/* URL firmada temporal para ver o descargar un archivo privado. Una hora por
   defecto; se puede pedir más larga cuando la liga va a viajar fuera del CRM
   (p. ej. el diseño de un personalizado mandado al proveedor por WhatsApp). */
export async function urlFirmada(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  segundos: number = 60 * 60,
): Promise<{ url: string } | { error: string }> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, segundos);
  if (error || !data) return { error: error?.message ?? "No se pudo generar el enlace." };
  return { url: data.signedUrl };
}

/* Lo mismo para una lista. Devuelve un mapa ruta → URL; las rutas que fallen
   simplemente no aparecen (la vista pinta un hueco en vez de romperse).

   Con `ancho`/`alto` pide además la MINIATURA: Supabase redimensiona y, si el
   navegador lo acepta, entrega webp. No es un lujo — los diseños de los
   cinturones pesan ~830 KB cada uno, y una tabla de 160 sin esto son 130 MB.

   `resize: "contain"` NO es opcional: el modo por defecto de Supabase es
   "cover", que rellena la caja RECORTANDO lo que sobra. Con un diseño de
   2048×203 pedido a 420 de ancho, "cover" devolvía 420×203 —el 80% del
   cinturón cortado— mientras que "contain" devuelve 420×42, el cinturón
   entero. Hay que dar las dos medidas: la caja es un máximo, y la imagen entra
   dentro conservando su proporción, sin rellenar los lados.

   La transformación va firmada DENTRO del token, así que con miniatura hay que
   firmar de una en una (la llamada en lote no la admite). Se hace en paralelo,
   por lotes, que es la diferencia entre 3 segundos y 1. */
export async function urlesFirmadas(
  supabase: SupabaseClient,
  bucket: string,
  paths: string[],
  opciones?: { ancho?: number; alto?: number; calidad?: number },
): Promise<Record<string, string>> {
  const unicas = [...new Set(paths.filter(Boolean))];
  if (!unicas.length) return {};

  const mapa: Record<string, string> = {};

  if (!opciones?.ancho) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(unicas, 60 * 60);
    if (error || !data) return {};
    for (const fila of data) {
      if (fila.path && fila.signedUrl && !fila.error) mapa[fila.path] = fila.signedUrl;
    }
    return mapa;
  }

  const LOTE = 40;
  const transform = {
    width: opciones.ancho,
    height: opciones.alto ?? opciones.ancho,
    resize: "contain" as const,
    quality: opciones.calidad ?? 60,
  };
  for (let i = 0; i < unicas.length; i += LOTE) {
    const lote = unicas.slice(i, i + LOTE);
    const firmadas = await Promise.all(
      lote.map((path) =>
        supabase.storage
          .from(bucket)
          .createSignedUrl(path, 60 * 60, { transform })
          .then((r) => [path, r.data?.signedUrl ?? null] as const),
      ),
    );
    for (const [path, url] of firmadas) if (url) mapa[path] = url;
  }
  return mapa;
}
