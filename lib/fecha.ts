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

/* Fecha y hora legibles, ej. "10 jul, 14:30", ancladas a la zona del negocio.
   (Era la misma función copiada en varios componentes de inventario/tareas.) */
export function formatearFechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  });
}

/* Fecha larga legible de un AAAA-MM-DD, ej. "10 de julio". El T12:00:00 evita
   que la zona horaria corra el día al parsear una fecha sin hora. */
export function formatearFechaLarga(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
  });
}

/* Fecha/hora actual vista desde México (zona del negocio). Anclarla aquí hace
   que el servidor (UTC en Vercel) y el navegador calculen el MISMO día: sin
   esto, el HTML del servidor y el del cliente difieren cerca de la medianoche
   y React truena la hidratación (error #418), además de marcar vencidas y
   periodos con horas de adelanto. */
export function ahoraMX(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
}

/* Día calendario (AAAA-MM-DD) de un INSTANTE, visto desde México.
   Es la conversión que faltaba en los importadores de ventas: las APIs de los
   canales devuelven un instante con su propio huso ("2026-08-02T23:30:00-04:00",
   o epoch en segundos), y cortarlo con slice(0,10) —o pasarlo por toISOString()—
   se queda con el día de ESE huso, no con el nuestro. De ahí que una venta de la
   noche apareciera al día siguiente y los totales por rango no cuadraran contra
   los paneles oficiales.

   "en-CA" se usa porque su formato de fecha corta ya es AAAA-MM-DD. */
export function diaMX(instante: string | number | Date): string {
  const d = instante instanceof Date ? instante : new Date(instante);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

/* Hora del día ("HH:mm", 24 h) de un INSTANTE, vista desde México. Es la otra
   mitad de diaMX(): la maquila necesita saber si un pago cayó antes o después
   de la hora límite de corte, y compararlo en el huso del servidor daría un
   corte distinto según dónde corra el código. "en-GB" porque su formato corto
   ya es HH:mm con cero a la izquierda (comparable como texto). */
export function horaMX(instante: string | number | Date): string {
  const d = instante instanceof Date ? instante : new Date(instante);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  });
}

/* Hoy en formato AAAA-MM-DD (zona de México). */
export function hoyISO(): string {
  const d = ahoraMX();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* ¿La tarea está vencida? (fecha límite pasada y todavía abierta).
   `cancelada` cuenta como cerrada: lo que se decidió no hacer no se vence. */
export function esVencida(fechaLimite: string | null, estado: string): boolean {
  if (!fechaLimite) return false;
  return fechaLimite < hoyISO() && estado !== "hecho" && estado !== "cancelada";
}

/* ---- Recordatorios: puente entre <input type="datetime-local"> e ISO ----
   El input da/espera "AAAA-MM-DDTHH:mm" en hora LOCAL; en la BD guardamos ISO
   (UTC). Se usan en el navegador (equipo en zona de México), así que `new Date`
   interpreta el valor local correctamente. */
export function isoALocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
export function localInputAIso(valor: string): string | null {
  if (!valor) return null;
  const d = new Date(valor);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/* Un pedido que aún no sale lleva demasiados días sin despacharse. */
export const DIAS_ATRASO_PEDIDO = 3;

/* Los estados en los que el pedido TODAVÍA NO SALIÓ: los únicos que pueden
   atrasarse. Antes esto era "todo lo que no está entregado ni cancelado", y
   entraba también `enviado`: un paquete despachado a tiempo se pintaba rojo al
   cuarto día y ahí se quedaba para siempre, porque el "entregado" casi nunca
   volvía del canal. "Atrasado" pasó a querer decir lo único sobre lo que se
   puede actuar hoy —empacarlo y sacarlo—; lo que ya salió y tardó se mide con
   el plazo de despacho (lib/canales/despacho.ts), no con esto. */
const ESTADOS_POR_DESPACHAR = ["nuevo", "preparando"];

/* ¿El pedido está atrasado? (sin despachar y su fecha es de hace más de N días). */
export function esPedidoAtrasado(fecha: string, estado: string | null): boolean {
  if (!estado || !ESTADOS_POR_DESPACHAR.includes(estado)) return false;
  return fecha < diasDesdeHoy(-DIAS_ATRASO_PEDIDO);
}

/* Días transcurridos desde la fecha de la venta (0 = hoy). Para decir cuánto
   lleva un paquete en la calle sin sonar a alarma. */
export function diasDesdeFecha(fecha: string): number {
  return diasEntre(fecha, hoyISO());
}

/* ---- Helpers de PERIODOS (módulo Métricas; todo en fecha LOCAL) ---- */

/* AAAA-MM-DD de una fecha local. */
function aISO(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* Fecha (zona de México) desplazada n días respecto a hoy (negativo = pasado). */
export function diasDesdeHoy(n: number): string {
  const d = ahoraMX();
  d.setDate(d.getDate() + n);
  return aISO(d);
}

export type Periodo = { desde: string; hasta: string };

/* Días entre dos fechas ISO (inclusive el primero). */
function diasEntre(desde: string, hasta: string): number {
  const ms = Date.parse(`${hasta}T00:00:00`) - Date.parse(`${desde}T00:00:00`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/* Fecha ISO desplazada n días (sirve para cualquier fecha, no solo hoy). */
function isoMas(fecha: string, n: number): string {
  const d = new Date(`${fecha}T00:00:00`);
  d.setDate(d.getDate() + n);
  return aISO(d);
}

/* Igual que isoMas pero público: suma n días a una fecha ISO "AAAA-MM-DD".
   Devuelve "" si la fecha de entrada está vacía. */
export function sumarDias(fecha: string, n: number): string {
  return fecha ? isoMas(fecha, n) : "";
}

/* Rango libre elegido a mano y su bloque inmediatamente anterior del MISMO
   largo, para que el Δ de las tarjetas siga teniendo con qué comparar. */
export function rangoPersonalizado(desde: string, hasta: string): {
  actual: Periodo;
  anterior: Periodo;
} {
  // Si los escriben al revés, se enderezan solos.
  const [ini, fin] = desde <= hasta ? [desde, hasta] : [hasta, desde];
  const largo = diasEntre(ini, fin) + 1;
  return {
    actual: { desde: ini, hasta: fin },
    anterior: { desde: isoMas(ini, -largo), hasta: isoMas(ini, -1) },
  };
}

/* Atajos de rango que ofrece el selector de fechas. Son los que pidió Armando
   ("últimos 30 días, últimos 7, últimos 15, mes actual, semana actual"), más
   ayer, que sale gratis. El orden es el que se pinta en la columna. */
export const PRESETS_RANGO = [
  { id: "hoy", nombre: "Hoy" },
  { id: "ayer", nombre: "Ayer" },
  { id: "ultimos_7", nombre: "Últimos 7 días" },
  { id: "ultimos_15", nombre: "Últimos 15 días" },
  { id: "ultimos_30", nombre: "Últimos 30 días" },
  { id: "semana", nombre: "Semana actual" },
  { id: "mes", nombre: "Mes actual" },
  { id: "mes_pasado", nombre: "Mes pasado" },
] as const;

export type PresetRangoId = (typeof PRESETS_RANGO)[number]["id"];

/* Rango del periodo elegido y su equivalente ANTERIOR (para el Δ de
   comparación): hoy↔ayer, semana↔semana pasada, mes↔mes pasado, etc.
   Los "últimos N días" se comparan contra los N días inmediatamente previos. */
export function rangosDePeriodo(id: PresetRangoId): {
  actual: Periodo;
  anterior: Periodo;
} {
  const hoy = ahoraMX();
  const y = hoy.getFullYear();
  const m = hoy.getMonth();

  if (id === "hoy") {
    return {
      actual: { desde: hoyISO(), hasta: hoyISO() },
      anterior: { desde: diasDesdeHoy(-1), hasta: diasDesdeHoy(-1) },
    };
  }
  if (id === "ayer") {
    return {
      actual: { desde: diasDesdeHoy(-1), hasta: diasDesdeHoy(-1) },
      anterior: { desde: diasDesdeHoy(-2), hasta: diasDesdeHoy(-2) },
    };
  }
  if (id === "ultimos_7" || id === "ultimos_15" || id === "ultimos_30") {
    /* Ventana móvil que INCLUYE hoy: "últimos 7" = hoy y los 6 anteriores, que
       es como lo cuentan los paneles de los canales. */
    const n = id === "ultimos_7" ? 7 : id === "ultimos_15" ? 15 : 30;
    return {
      actual: { desde: diasDesdeHoy(-(n - 1)), hasta: hoyISO() },
      anterior: { desde: diasDesdeHoy(-(2 * n - 1)), hasta: diasDesdeHoy(-n) },
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
