/* ============================================================================
   lib/agencia.ts — Catálogos y cálculo de la Agencia Fresafit
   ----------------------------------------------------------------------------
   La agencia le lleva la operación a otros negocios y les cobra con una fórmula:
   una parte fija al mes más un porcentaje de lo que ese negocio vendió. Aquí
   viven las etiquetas de esos conceptos y la aritmética del corte.

   La aritmética está separada de la interfaz a propósito: un cobro mal calculado
   se descubre semanas después, cuando el cliente reclama, así que conviene que
   la fórmula esté en un solo sitio y sea legible.
   ============================================================================ */

/* --------------------------------- Catálogos ------------------------------ */

/* Sobre qué se aplica el porcentaje. Tres formas de cada una porque las tres se
   usan en sitios distintos: `nombre` como etiqueta suelta, `enFrase` dentro de
   una oración ("4% de ventas brutas" — bajar el nombre a minúsculas convertía
   GMV en "gmv"), y `desc` como la definición que evita discusiones al cerrar el
   mes. */
export const BASES_CALCULO = [
  {
    id: "ventas_brutas",
    nombre: "Ventas brutas",
    enFrase: "ventas brutas",
    desc: "Todo lo vendido, menos cancelaciones, devoluciones y pedidos nunca aprobados.",
  },
  {
    id: "gmv_antes_impuestos",
    nombre: "GMV antes de impuestos",
    enFrase: "GMV antes de impuestos",
    desc: "El valor de la mercancía vendida, sin IVA ni retenciones de la plataforma.",
  },
  {
    id: "ventas_netas",
    nombre: "Ventas netas",
    enFrase: "ventas netas",
    desc: "Lo vendido después de comisiones de plataforma y envíos.",
  },
  {
    id: "otro",
    nombre: "Otra base",
    enFrase: "la base acordada",
    desc: "Se explica en las notas del contrato.",
  },
] as const;

export const PLATAFORMAS_AGENCIA = [
  { id: "shopify", nombre: "Shopify" },
  { id: "tiktok_shop", nombre: "TikTok Shop" },
  { id: "tienda_nube", nombre: "Tienda Nube" },
  { id: "mercado_libre", nombre: "Mercado Libre" },
  { id: "amazon", nombre: "Amazon" },
  { id: "otro", nombre: "Otra" },
] as const;

export const PERIODICIDADES = [
  { id: "mensual", nombre: "Mensual" },
  { id: "quincenal", nombre: "Quincenal" },
] as const;

export const TIPOS_INGRESO = [
  { id: "contrato", nombre: "Corte de contrato", color: "#e84393" },
  { id: "migracion", nombre: "Migración de plataforma", color: "#0984e3" },
  { id: "referido", nombre: "Comisión por referido", color: "#00b894" },
  { id: "otro", nombre: "Otro", color: "#636e72" },
] as const;

/* El ciclo de un cobro. "Calculado" es lo que sacó el CRM y todavía no se le
   pasa al cliente; "cobrado" es que ya se le pidió; "pagado" es que el dinero
   entró. La distinción importa porque lo cobrado-y-no-pagado es exactamente lo
   que hay que ir a perseguir. */
export const ESTADOS_INGRESO = [
  { id: "calculado", nombre: "Calculado", color: "#b2bec3" },
  { id: "cobrado", nombre: "Cobrado", color: "#fdcb6e" },
  { id: "pagado", nombre: "Pagado", color: "#00b894" },
  { id: "cancelado", nombre: "Cancelado", color: "#d63031" },
] as const;

export const ESQUEMAS_PAGO = [
  { id: "sueldo", nombre: "Sueldo" },
  { id: "honorarios", nombre: "Honorarios" },
  { id: "por_proyecto", nombre: "Por proyecto" },
  { id: "comision", nombre: "Comisión" },
  { id: "destajo", nombre: "Por evento / destajo" },
] as const;

export const PERIODICIDADES_PAGO = [
  { id: "semanal", nombre: "Semanal" },
  { id: "quincenal", nombre: "Quincenal" },
  { id: "mensual", nombre: "Mensual" },
  { id: "por_evento", nombre: "Por evento" },
] as const;

/* Bajo qué figura está cada persona. Es la pregunta incómoda que hay que poder
   contestar de un vistazo cuando se regulariza al equipo. */
export const SITUACIONES_LABORALES = [
  { id: "imss", nombre: "IMSS", color: "#00b894" },
  { id: "contrato", nombre: "Contrato", color: "#0984e3" },
  { id: "honorarios", nombre: "Honorarios", color: "#fdcb6e" },
  { id: "sin_formalizar", nombre: "Sin formalizar", color: "#d63031" },
] as const;

export const ESTADOS_PAGO_NOMINA = [
  { id: "pendiente", nombre: "Pendiente", color: "#fdcb6e" },
  { id: "pagado", nombre: "Pagado", color: "#00b894" },
] as const;

export type BaseCalculoId = (typeof BASES_CALCULO)[number]["id"];
export type PlataformaAgenciaId = (typeof PLATAFORMAS_AGENCIA)[number]["id"];
export type TipoIngresoId = (typeof TIPOS_INGRESO)[number]["id"];
export type EstadoIngresoId = (typeof ESTADOS_INGRESO)[number]["id"];
export type EsquemaPagoId = (typeof ESQUEMAS_PAGO)[number]["id"];
export type PeriodicidadPagoId = (typeof PERIODICIDADES_PAGO)[number]["id"];
export type SituacionLaboralId = (typeof SITUACIONES_LABORALES)[number]["id"];
export type EstadoPagoNominaId = (typeof ESTADOS_PAGO_NOMINA)[number]["id"];

function buscar<T extends { id: string }>(lista: readonly T[], id: string | null): T | null {
  return lista.find((x) => x.id === id) ?? null;
}
export const obtenerBaseCalculo = (id: string | null) => buscar(BASES_CALCULO, id);
export const obtenerPlataformaAgencia = (id: string | null) => buscar(PLATAFORMAS_AGENCIA, id);
export const obtenerTipoIngreso = (id: string | null) => buscar(TIPOS_INGRESO, id);
export const obtenerEstadoIngreso = (id: string | null) => buscar(ESTADOS_INGRESO, id);
export const obtenerEsquemaPago = (id: string | null) => buscar(ESQUEMAS_PAGO, id);
export const obtenerSituacionLaboral = (id: string | null) => buscar(SITUACIONES_LABORALES, id);
export const obtenerEstadoPagoNomina = (id: string | null) => buscar(ESTADOS_PAGO_NOMINA, id);

/* ------------------------------ El corte ---------------------------------- */

export type ReglaCobro = {
  monto_fijo: number;
  porcentaje: number;
  fondo_delegado: number;
};

export type DesgloseCorte = {
  monto_fijo: number;
  monto_variable: number;
  fondo_delegado: number;
  /* Lo que de verdad gana la agencia: fijo + variable. El fondo delegado NO
     entra, porque es dinero del cliente que solo pasa por aquí camino a la
     gente que paga (los 30 000 de los lives de Nutravia). */
  honorarios: number;
  /* Lo que se le pide al cliente en total, fondo incluido. */
  total: number;
};

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/* El cálculo del corte, en un solo sitio. `ventasBase` es lo que vendió el
   cliente en el periodo, capturado a mano al cerrar (Shopify y el TikTok Shop
   del cliente no los lee el CRM). */
export function calcularCorte(regla: ReglaCobro, ventasBase: number): DesgloseCorte {
  const base = Number.isFinite(ventasBase) && ventasBase > 0 ? ventasBase : 0;
  const monto_fijo = redondear(regla.monto_fijo || 0);
  const monto_variable = redondear((base * (regla.porcentaje || 0)) / 100);
  const fondo_delegado = redondear(regla.fondo_delegado || 0);
  const honorarios = redondear(monto_fijo + monto_variable);
  return {
    monto_fijo,
    monto_variable,
    fondo_delegado,
    honorarios,
    total: redondear(honorarios + fondo_delegado),
  };
}

/* ---------------------------- Periodos de corte --------------------------- */

/* El periodo que cierra un contrato, contando hacia atrás desde una fecha.

   `dia_corte` es el día del mes en que se cierra: 1 = se cobra el mes completo
   anterior; 15 = el periodo va del 15 del mes pasado al 14 de éste. Con esta
   regla, "calcular el corte" no le pide fechas a nadie: propone las que tocan y
   se pueden ajustar si hizo falta.

   Todas las fechas son AAAA-MM-DD; no se usa Date con huso porque un corte es un
   día de calendario, no un instante. */
export function periodoDeCorte(
  diaCorte: number,
  periodicidad: "mensual" | "quincenal",
  hoyISO: string,
): { desde: string; hasta: string } {
  const [a, m, d] = hoyISO.split("-").map(Number);
  const dia = Math.min(Math.max(diaCorte || 1, 1), 28);

  const iso = (año: number, mes: number, día: number) =>
    `${año}-${String(mes).padStart(2, "0")}-${String(día).padStart(2, "0")}`;

  /* Un día antes de una fecha dada, sin salir del calendario. */
  const díaAnterior = (año: number, mes: number, día: number) => {
    const f = new Date(Date.UTC(año, mes - 1, día));
    f.setUTCDate(f.getUTCDate() - 1);
    return iso(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
  };

  /* El último corte que YA cerró: el de este mes si su día ya pasó, si no el
     del mes anterior. Con dia_corte = 1 y hoy 3 de agosto, cerró el 1 de agosto
     y el periodo cobrable es julio completo. Con dia_corte = 15 y hoy 3 de
     agosto, el último que cerró fue el 15 de julio: 15 jun – 14 jul. */
  const cierre = new Date(Date.UTC(a, m - 1, dia));
  if (d < dia) cierre.setUTCMonth(cierre.getUTCMonth() - 1);

  const inicio = new Date(cierre);
  if (periodicidad === "quincenal") inicio.setUTCDate(inicio.getUTCDate() - 15);
  else inicio.setUTCMonth(inicio.getUTCMonth() - 1);

  return {
    desde: iso(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, inicio.getUTCDate()),
    /* El periodo termina el día ANTES del corte: si cierra el 15, cubre hasta
       el 14. Sin esto, dos cortes seguidos se solapan un día. */
    hasta: díaAnterior(cierre.getUTCFullYear(), cierre.getUTCMonth() + 1, cierre.getUTCDate()),
  };
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/* Nombre legible del periodo, para el concepto del cobro:
   "1–31 jul 2026" cuando cae dentro de un mes, "15 jun – 14 jul 2026" cuando lo
   cruza. */
export function nombrePeriodo(desde: string, hasta: string): string {
  const [aD, mD, dD] = desde.split("-").map(Number);
  const [aH, mH, dH] = hasta.split("-").map(Number);
  if (aD === aH && mD === mH) return `${dD}–${dH} ${MESES_CORTOS[mD - 1]} ${aD}`;
  const año = aD === aH ? "" : ` ${aD}`;
  return `${dD} ${MESES_CORTOS[mD - 1]}${año} – ${dH} ${MESES_CORTOS[mH - 1]} ${aH}`;
}
