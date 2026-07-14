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

/* Hoy en formato AAAA-MM-DD, en la zona horaria LOCAL del usuario.
   (Usar toISOString() daría la fecha UTC y marcaría tareas como vencidas
   horas antes en husos negativos como México, UTC-6.) */
export function hoyISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* ¿La tarea está vencida? (fecha límite pasada y no está "hecho"). */
export function esVencida(fechaLimite: string | null, estado: string): boolean {
  if (!fechaLimite) return false;
  return fechaLimite < hoyISO() && estado !== "hecho";
}

/* ---- Helpers de PERIODOS (módulo Métricas; todo en fecha LOCAL) ---- */

/* AAAA-MM-DD de una fecha local. */
function aISO(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* Fecha local desplazada n días respecto a hoy (n negativo = pasado). */
export function diasDesdeHoy(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return aISO(d);
}

export type Periodo = { desde: string; hasta: string };

/* Rango del periodo elegido y su equivalente ANTERIOR (para el Δ de
   comparación): hoy↔ayer, semana↔semana pasada, mes↔mes pasado, etc. */
export function rangosDePeriodo(id: "hoy" | "semana" | "mes" | "mes_pasado"): {
  actual: Periodo;
  anterior: Periodo;
} {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = hoy.getMonth();

  if (id === "hoy") {
    return {
      actual: { desde: hoyISO(), hasta: hoyISO() },
      anterior: { desde: diasDesdeHoy(-1), hasta: diasDesdeHoy(-1) },
    };
  }
  if (id === "semana") {
    // Semana de lunes a domingo.
    const offset = (hoy.getDay() + 6) % 7;
    const lunes = new Date(y, m, hoy.getDate() - offset);
    const lunesPasado = new Date(y, m, hoy.getDate() - offset - 7);
    const domingoPasado = new Date(y, m, hoy.getDate() - offset - 1);
    return {
      actual: { desde: aISO(lunes), hasta: hoyISO() },
      anterior: { desde: aISO(lunesPasado), hasta: aISO(domingoPasado) },
    };
  }
  if (id === "mes") {
    return {
      actual: { desde: aISO(new Date(y, m, 1)), hasta: hoyISO() },
      anterior: { desde: aISO(new Date(y, m - 1, 1)), hasta: aISO(new Date(y, m, 0)) },
    };
  }
  // mes_pasado (comparado contra el antepasado)
  return {
    actual: { desde: aISO(new Date(y, m - 1, 1)), hasta: aISO(new Date(y, m, 0)) },
    anterior: { desde: aISO(new Date(y, m - 2, 1)), hasta: aISO(new Date(y, m - 1, 0)) },
  };
}

/* ---- Helpers para la vista de CALENDARIO (sin librerías externas) ---- */

const NOMBRES_MES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/* Título del mes, ej. "Julio 2026". */
export function nombreMes(anio: number, mes: number): string {
  return `${NOMBRES_MES[mes]} ${anio}`;
}

/* Fecha AAAA-MM-DD a partir de año/mes(0-11)/día, en local. */
function iso(anio: number, mes: number, dia: number): string {
  const mm = String(mes + 1).padStart(2, "0");
  const dd = String(dia).padStart(2, "0");
  return `${anio}-${mm}-${dd}`;
}

export type CeldaDia = { iso: string; dia: number; esDelMes: boolean };

/* Matriz del mes (semanas de lunes a domingo) para pintar el calendario.
   Devuelve 6 filas × 7 días, incluyendo relleno de meses vecinos. */
export function matrizMes(anio: number, mes: number): CeldaDia[][] {
  const primero = new Date(anio, mes, 1);
  // getDay(): 0=domingo … 6=sábado. Queremos que la semana empiece en LUNES.
  const offset = (primero.getDay() + 6) % 7;
  const inicio = new Date(anio, mes, 1 - offset);

  const semanas: CeldaDia[][] = [];
  const cursor = new Date(inicio);
  for (let s = 0; s < 6; s++) {
    const semana: CeldaDia[] = [];
    for (let d = 0; d < 7; d++) {
      semana.push({
        iso: iso(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()),
        dia: cursor.getDate(),
        esDelMes: cursor.getMonth() === mes,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    semanas.push(semana);
  }
  return semanas;
}
