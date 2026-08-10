/* ============================================================================
   lib/maquila/corte.ts — La aritmética del corte quincenal
   ----------------------------------------------------------------------------
   Espejo en TypeScript de lo que hacen maquila_recalcular_totales y
   maquila_cerrar_corte (20260929000000). La base es la que manda —es donde se
   escribe—; esto existe para PREVISUALIZAR: enseñar «así quedaría» antes de
   cerrar, cuando todavía no hay nada que enseñar de la base.

   Funciones puras, sin imports de datos.
   ============================================================================ */

export type RenglonParaCorte = { cantidad: number; importe: number; anulado?: boolean };
export type AnticipoParaCorte = { id: string; fecha: string; saldo: number };

export type TotalesCorte = {
  piezas: number;
  subtotal: number;
  iva: number;
  anticiposAplicados: number;
  total: number;
};

/* Redondeo a dos decimales, el mismo que hace `round(x, 2)` en Postgres. Sin
   esto, el preview y el corte cerrado se separan por centavos y parece que
   uno de los dos está mal. */
function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

/* Cuánto de cada anticipo se consume, en FIFO por fecha: se gasta primero lo
   más viejo, que es como se lleva cualquier cuenta a favor. */
export function aplicarAnticiposFIFO(
  anticipos: AnticipoParaCorte[],
  porPagar: number,
): { anticipoId: string; monto: number }[] {
  const out: { anticipoId: string; monto: number }[] = [];
  let resto = porPagar;

  const ordenados = [...anticipos]
    .filter((a) => a.saldo > 0)
    .sort((a, b) => (a.fecha === b.fecha ? a.id.localeCompare(b.id) : a.fecha.localeCompare(b.fecha)));

  for (const a of ordenados) {
    if (resto <= 0) break;
    const monto = centavos(Math.min(a.saldo, resto));
    out.push({ anticipoId: a.id, monto });
    resto = centavos(resto - monto);
  }
  return out;
}

/* Los totales de un corte: piezas, subtotal, IVA aparte, anticipos y lo que
   queda por pagar. `tasaIva` viaja como parámetro porque el corte la congela
   al crearse: si cambia la ley, los cortes viejos no se mueven. */
export function calcularCorte(
  renglones: RenglonParaCorte[],
  anticipos: AnticipoParaCorte[],
  tasaIva = 0.16,
): TotalesCorte {
  const vivos = renglones.filter((r) => !r.anulado);
  const piezas = vivos.reduce((s, r) => s + r.cantidad, 0);
  const subtotal = centavos(vivos.reduce((s, r) => s + r.importe, 0));
  const iva = centavos(subtotal * tasaIva);

  const aplicados = aplicarAnticiposFIFO(anticipos, centavos(subtotal + iva));
  const anticiposAplicados = centavos(aplicados.reduce((s, a) => s + a.monto, 0));

  return {
    piezas,
    subtotal,
    iva,
    anticiposAplicados,
    total: centavos(subtotal + iva - anticiposAplicados),
  };
}
