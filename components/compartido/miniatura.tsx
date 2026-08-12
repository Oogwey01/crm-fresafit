import { Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* Miniatura de la portada de un producto. Vivía en
   components/inventario/celdas-producto.tsx; se sacó aquí al necesitarla también
   el tablero de maquila, con el mismo criterio con que aquellas celdas salieron
   de tabla-productos.tsx: antes dos copias que se separen.

   Se usa <img> plano en vez de next/image para no tener que allowlistar el
   hostname del CDN de Tienda Nube en next.config; para una miniatura es
   suficiente. Cae a un placeholder cuando el producto no tiene foto.

   `object-contain` sobre fondo suave, no `cover`: las fotos del catálogo vienen
   con fondo blanco y encuadre propio, y recortarlas para llenar el cuadro le
   comía los bordes al producto —las asas y las correas de las mochilas—. Al
   agrandarlas ese recorte se notaba el doble. */
export function Miniatura({
  src,
  alt,
  tam = "size-20",
}: {
  src: string | null;
  alt: string;
  tam?: string;
}) {
  if (!src) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground/50",
          tam,
        )}
      >
        <ImageIcon className="size-6 md:size-8" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={cn("shrink-0 rounded-lg border bg-muted/30 object-contain", tam)}
    />
  );
}
