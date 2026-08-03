import type { SaleConProducto } from "@/lib/types";

/* Nombre legible de una venta: producto · variante, o su descripción libre.
   Estaba copiado en cliente-detalle, metricas/panel y pedidos/panel (ahí como
   `nombrePedido`). */
export function nombreVenta(v: SaleConProducto): string {
  return v.producto
    ? `${v.producto.nombre}${v.producto.variante ? ` · ${v.producto.variante}` : ""}`
    : (v.descripcion ?? "—");
}
