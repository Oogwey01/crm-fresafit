import type { Product } from "@/lib/types";

/* Nombre legible de una venta: producto · variante, o su descripción libre.
   Estaba copiado en cliente-detalle, metricas/panel y pedidos/panel (ahí como
   `nombrePedido`).

   Pide solo los dos campos que usa, no una venta completa: los módulos
   seleccionan columnas distintas según lo que pintan (VentaMetricas,
   PedidoEnvio, SaleConProducto) y todos deben poder llamarla. */
export function nombreVenta(v: {
  producto: Pick<Product, "nombre" | "variante"> | null;
  descripcion: string | null;
}): string {
  return v.producto
    ? `${v.producto.nombre}${v.producto.variante ? ` · ${v.producto.variante}` : ""}`
    : (v.descripcion ?? "—");
}
