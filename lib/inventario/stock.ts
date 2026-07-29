/* ============================================================================
   lib/inventario/stock.ts  —  Semáforo de stock (Fresafit CRM)
   ----------------------------------------------------------------------------
   "Stock bajo" a secas mezclaba dos cosas muy distintas: lo que YA se acabó
   (cientos de variantes agotadas en la tienda) y lo que ESTÁ POR acabarse (lo
   accionable: hay que pedirlo al proveedor). Se separan.
   ============================================================================ */

export type EstadoStock = "agotado" | "por_acabarse" | "ok";

export const ESTADOS_STOCK = [
  { id: "por_acabarse", nombre: "Por acabarse", color: "#f59e0b" }, // ámbar
  { id: "agotado", nombre: "Agotado", color: "#d63031" },           // rojo
  { id: "ok", nombre: "Con stock", color: "#22c55e" },              // verde
] as const;

type ProductoStock = {
  stock: number;
  stock_minimo: number;
  activo: boolean;
  bajo_pedido?: boolean;
  descontinuado?: boolean;
};

/* Los productos inactivos no alertan: están fuera del catálogo a propósito.
   Los de bajo pedido tampoco: se fabrican cuando alguien los compra, así que su
   stock 0 es lo normal y no hay nada que reponer. Los descontinuados tampoco:
   ya no se reponen, así que su stock bajo no es un faltante que accionar. */
export function estadoStock(p: ProductoStock): EstadoStock {
  if (!p.activo || p.bajo_pedido || p.descontinuado) return "ok";
  if (p.stock === 0) return "agotado";
  if (p.stock <= p.stock_minimo) return "por_acabarse";
  return "ok";
}

export function obtenerEstadoStock(id: string) {
  return ESTADOS_STOCK.find((e) => e.id === id) ?? null;
}
