/* ============================================================================
   lib/moneda.ts  —  Formato de dinero (Fresafit CRM)
   ============================================================================ */

const FORMATO_MXN = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

/* "$1,234.50" (MXN). Para valores ausentes devuelve "—". */
export function formatearMXN(monto: number | null | undefined): string {
  if (monto === null || monto === undefined) return "—";
  return FORMATO_MXN.format(monto);
}

/* "$1.7k", "$12k", "$980" — para rotular gráficas, donde el importe completo no
   cabe dentro del ancho de una barra. Los centavos se van a propósito: a esa
   escala no cambian la lectura y sí estorban. */
export function formatearMXNCorto(monto: number | null | undefined): string {
  if (monto === null || monto === undefined) return "—";
  const abs = Math.abs(monto);
  const signo = monto < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${signo}$${recortar(abs / 1_000_000, abs >= 10_000_000)}M`;
  if (abs >= 1_000) return `${signo}$${recortar(abs / 1_000, abs >= 10_000)}k`;
  return `${signo}$${Math.round(abs)}`;
}

/* Un decimal, salvo que sobre ("1.0k" se lee peor que "1k"). */
function recortar(valor: number, entero: boolean): string {
  if (entero) return String(Math.round(valor));
  const texto = valor.toFixed(1);
  return texto.endsWith(".0") ? texto.slice(0, -2) : texto;
}
