/* Helpers de periodos/deltas compartidos por Finanzas y Métricas (cada panel
   tenía su copia idéntica). */

import type { Periodo } from "@/lib/fecha";

/* Periodos con comparativo (los paneles pueden extender con "personalizado"). */
export type PeriodoBaseId = "hoy" | "semana" | "mes" | "mes_pasado";

export const ETIQUETA_DELTA: Record<PeriodoBaseId, string> = {
  hoy: "vs. ayer",
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
