import { estadoStock } from "@/lib/inventario/stock";
import type { ProductConProveedor } from "@/lib/types";

/* Pastilla del semáforo de stock. Vive aparte porque la pintan igual la tabla y
   el pop-up del producto. */
export function BadgeStock({ producto }: { producto: ProductConProveedor }) {
  if (producto.bajo_pedido) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground"
        title="Se fabrica cuando alguien lo compra: no lleva inventario."
      >
        Bajo pedido
      </span>
    );
  }
  const estado = estadoStock(producto);
  if (estado === "agotado") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-600 dark:bg-red-950 dark:text-red-300">
        <span className="size-1.5 rounded-full bg-red-500" />
        Agotado
      </span>
    );
  }
  if (estado === "por_acabarse") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
        <span className="size-1.5 rounded-full bg-amber-500" />
        Por acabarse
      </span>
    );
  }
  if (!producto.activo) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700 dark:bg-green-950 dark:text-green-300">
      <span className="size-1.5 rounded-full bg-green-500" />
      OK
    </span>
  );
}
