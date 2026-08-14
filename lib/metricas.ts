/* Helpers de periodos/deltas compartidos por Finanzas y Métricas (cada panel
   tenía su copia idéntica). */

import type { Periodo, PresetRangoId } from "@/lib/fecha";

/* Periodos con comparativo (los paneles pueden extender con "personalizado"). */
export type PeriodoBaseId = PresetRangoId;

export const ETIQUETA_DELTA: Record<PeriodoBaseId, string> = {
  hoy: "vs. ayer",
  ayer: "vs. anteayer",
  ultimos_7: "vs. 7 días previos",
  ml_7_mas_hoy: "vs. 8 días previos",
  ultimos_15: "vs. 15 días previos",
  ultimos_30: "vs. 30 días previos",
  semana: "vs. semana pasada",
  mes: "vs. mes pasado",
  mes_pasado: "vs. antepasado",
};

/* Renglones que se pintan de golpe en la tabla de ventas; el resto entra con
   «Ver más», que ahora pide la página siguiente al servidor en vez de tenerlo
   todo ya en memoria. */
export const VENTAS_POR_PAGINA = 100;

/* Lo que la tabla de ventas necesita de cada renglón (y el diálogo al editar).
   Vive aquí porque lo comparten la carga inicial de la página y la acción que
   trae las páginas siguientes: si las dos listas se separan, la tabla cambia de
   forma a mitad del scroll.

   SIN `monto`, y no por descuido: la columna está fuera del alcance del token
   del navegador (ver 20260902000000) y el importe se pide aparte, a la vista
   `ventas_montos`, que decide por quién pregunta. Lo une `adjuntarMontos`. */
export const COLUMNAS_VENTA_METRICAS =
  "id, fecha, canal, cantidad, descripcion, notas, origen," +
  " producto_id, cliente_id, referencia_externa," +
  " producto:products!producto_id(id, nombre, variante, tipo)";

/* ¿La fecha ISO cae dentro del rango (inclusive)? */
export function enRango(fecha: string, r: Periodo): boolean {
  return fecha >= r.desde && fecha <= r.hasta;
}

/* Variación porcentual contra el periodo anterior (null si no hay base). */
export function deltaPct(actual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return ((actual - anterior) / anterior) * 100;
}
