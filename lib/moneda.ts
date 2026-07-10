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
