import { createClient } from "@/lib/supabase/client";
import type { ProductConProveedor } from "@/lib/types";

const BUCKET = "fotos-productos";

/* URL pública de una foto subida a mano. El bucket es público, así que no hay
   que firmar nada: la URL se sirve igual que las del CDN de los canales. */
export function urlFotoProducto(storagePath: string): string {
  return createClient().storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

/* Galería completa: primero lo que subimos a mano, luego lo importado de Tienda
   Nube / Mercado Libre. Las propias mandan porque son la foto que el equipo
   eligió; las del canal las reescribe cada sincronización. */
export function galeriaProducto(p: ProductConProveedor): { src: string; foto: ProductPhotoRef | null }[] {
  const propias = (p.fotos_propias ?? []).map((f) => ({
    src: urlFotoProducto(f.storage_path),
    foto: { id: f.id, storage_path: f.storage_path },
  }));
  return [...propias, ...p.imagenes.map((src) => ({ src, foto: null }))];
}

/* Lo mínimo para poder borrarla; `null` = importada del canal (no se borra aquí). */
export type ProductPhotoRef = { id: string; storage_path: string };

/* Portada: la foto propia manda sobre la importada. */
export function portadaProducto(p: ProductConProveedor): string | null {
  const propia = p.fotos_propias?.[0];
  if (propia) return urlFotoProducto(propia.storage_path);
  return p.imagen_url;
}
