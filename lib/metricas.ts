/* Helpers de periodos/deltas compartidos por Finanzas y Métricas (cada panel
   tenía su copia idéntica). */

import type { Periodo, PresetRangoId } from "@/lib/fecha";

/* Periodos con comparativo (los paneles pueden extender con "personalizado"). */
export type PeriodoBaseId = PresetRangoId;

export const ETIQUETA_DELTA: Record<PeriodoBaseId, string> = {
  hoy: "vs. ayer",
  ayer: "vs. anteayer",
  ultimos_7: "vs. 7 días previos",
  ultimos_15: "vs. 15 días previos",
  ultimos_30: "vs. 30 días previos",
  semana: "vs. semana pasada",
  mes: "vs. mes pasado",
  mes_pasado: "vs. antepasado",
};

/* ¿La fecha ISO cae dentro del rango (inclusive)? */
export function enRango(fecha: string, r: Periodo): boolean {
  return fecha >= r.desde && fecha <= r.hasta;
}

/* Variación porcentual contra el periodo anterior (null si no hay base). */
export function deltaPct(actual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return ((actual - anterior) / anterior) * 100;
}
