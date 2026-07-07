/* Helpers de fecha portados de la Fase 1 (js/modules/tasks.js). */

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/* Convierte "2026-07-10" en algo legible como "10 jul". */
export function formatearFecha(iso: string): string {
  const [, mm, dd] = iso.split("-");
  return `${parseInt(dd, 10)} ${MESES[parseInt(mm, 10) - 1]}`;
}

/* Hoy en formato AAAA-MM-DD (para comparar fechas límite). */
export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ¿La tarea está vencida? (fecha límite pasada y no está "hecho"). */
export function esVencida(fechaLimite: string | null, estado: string): boolean {
  if (!fechaLimite) return false;
  return fechaLimite < hoyISO() && estado !== "hecho";
}
