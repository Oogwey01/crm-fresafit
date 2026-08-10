/* ============================================================================
   lib/maquila/quincenas.ts — Las quincenas del corte a Eduardo
   ----------------------------------------------------------------------------
   Quincena NATURAL: del 1 al 15 y del 16 al último día del mes. Es como se
   piensa el pago («la quincena de agosto») y como ya trabaja la nómina de
   Fresafit.

   Deliberadamente NO se reusa `periodoDeCorte` de lib/agencia.ts: aquello es
   un corte rodante de 15 días hacia atrás desde un `dia_corte` configurable
   («del 16 al 15»), que es otra cosa.

   Funciones puras y, como lib/maquila/reglas.ts, este módulo NO IMPORTA NADA:
   es lo que deja correrlo con `node` a pelo desde
   scripts/probar-maquila-fase2.mjs, y en un cálculo del que cuelga un pago eso
   vale más que ahorrarse cuatro líneas. Las fechas son cadenas AAAA-MM-DD: una
   quincena es un tramo de calendario, no un instante, así que nada de husos.
   ============================================================================ */

export type Quincena = { desde: string; hasta: string };

function iso(año: number, mes: number, día: number): string {
  return `${año}-${String(mes).padStart(2, "0")}-${String(día).padStart(2, "0")}`;
}

/* Último día del mes, sin tablas de 30/31 ni casos de febrero: el día 0 del
   mes siguiente es el último del actual. */
export function ultimoDiaDelMes(año: number, mes: number): number {
  return new Date(Date.UTC(año, mes, 0)).getUTCDate();
}

/* La quincena en la que cae una fecha. */
export function quincenaDe(fecha: string): Quincena {
  const [a, m, d] = fecha.split("-").map(Number);
  return d <= 15
    ? { desde: iso(a, m, 1), hasta: iso(a, m, 15) }
    : { desde: iso(a, m, 16), hasta: iso(a, m, ultimoDiaDelMes(a, m)) };
}

/* La anterior a una dada. La primera del mes retrocede a la segunda del mes
   pasado, cruzando el año cuando toca. */
export function quincenaAnterior(q: Quincena): Quincena {
  const [a, m, d] = q.desde.split("-").map(Number);
  if (d === 16) return { desde: iso(a, m, 1), hasta: iso(a, m, 15) };
  const añoPrev = m === 1 ? a - 1 : a;
  const mesPrev = m === 1 ? 12 : m - 1;
  return { desde: iso(añoPrev, mesPrev, 16), hasta: iso(añoPrev, mesPrev, ultimoDiaDelMes(añoPrev, mesPrev)) };
}

/* Las `n` últimas quincenas contando la de `hoy`, de la más reciente a la más
   vieja: es lo que ofrece el selector del corte. */
export function quincenasRecientes(hoy: string, n = 6): Quincena[] {
  const out: Quincena[] = [];
  let q = quincenaDe(hoy);
  for (let i = 0; i < n; i++) {
    out.push(q);
    q = quincenaAnterior(q);
  }
  return out;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/* «1–15 ago 2026». Mismo formato que `nombrePeriodo` de lib/agencia.ts para el
   caso de un solo mes, que es el único que una quincena puede producir: aquí
   nunca se cruza el mes, así que la variante larga de allá no aplica. */
export function nombreQuincena(q: Quincena): string {
  const [a, m, d] = q.desde.split("-").map(Number);
  const dFin = Number(q.hasta.split("-")[2]);
  return `${d}–${dFin} ${MESES[m - 1]} ${a}`;
}

/* ¿Ya terminó? Una quincena en curso se puede calcular para ver cómo va, pero
   cerrarla antes de tiempo dejaría fuera lo que salga los días que faltan. */
export function quincenaCerrada(q: Quincena, hoy: string): boolean {
  return q.hasta < hoy;
}
