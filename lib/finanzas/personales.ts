/* ============================================================================
   lib/finanzas/personales.ts — «¿Cuánto me cuesta el mes?»
   ----------------------------------------------------------------------------
   La pregunta que contesta la sección personal de /finanzas no es cuánto pagué,
   sino cuánto tengo que apartar cada mes. Y para contestarla hay que poner en
   la misma moneda un recibo de luz bimestral, un dominio anual y el plan del
   celular: todo se divide entre los meses que cubre cada cobro.

   La aritmética vive aquí y no en el componente por lo de siempre: un total mal
   calculado en finanzas se descubre tarde y mal. Módulo puro —sin Supabase, sin
   React—, igual que sugerencias.ts.
   ============================================================================ */

import { obtenerPeriodicidadPersonal, CATEGORIAS_PERSONALES } from "@/lib/catalogos";
import { hoyISO, sumarDias } from "@/lib/fecha";
import type { CompromisoPersonal, PeriodicidadPersonalId } from "@/lib/types";

/* Lo que cuesta al mes UN compromiso.

   Se redondea a centavos AQUÍ, renglón por renglón, y el total suma sobre lo ya
   redondeado: así la columna «Al mes» de la tabla suma exactamente lo que dice
   la tarjeta de arriba. Sumar en crudo y redondear al final daría un total «más
   exacto» que no cuadra con la pantalla, y un total que no cuadra con sus
   renglones no se vuelve a creer nunca. */
export function costoMensual(monto: number, periodicidad: PeriodicidadPersonalId): number {
  const meses = obtenerPeriodicidadPersonal(periodicidad)?.mesesQueCubre ?? 1;
  if (!Number.isFinite(monto) || monto <= 0) return 0;
  return Math.round((monto / meses) * 100) / 100;
}

/* El total del mes: solo lo que sigue activo. Lo dado de baja se conserva en la
   lista pero ya no se paga, y meterlo aquí inflaría el número que sirve para
   decidir. */
export function totalMensual(compromisos: CompromisoPersonal[]): number {
  const suma = compromisos
    .filter((c) => c.activo)
    .reduce((acumulado, c) => acumulado + costoMensual(c.monto, c.periodicidad), 0);
  return Math.round(suma * 100) / 100;
}

/* El año se DERIVA del mes ×12; no se recalcula desde los montos. Si se
   calcularan por separado, un trimestral de $1,000 daría $333.33 × 12 =
   $3,999.96 arriba y $4,000 abajo, y las dos cifras de la misma pantalla se
   contradirían por cuatro centavos que nadie sabría explicar. */
export function totalAnual(compromisos: CompromisoPersonal[]): number {
  return Math.round(totalMensual(compromisos) * 12 * 100) / 100;
}

/* La próxima fecha de pago a partir del día del mes.

   OJO — solo se promete fecha exacta en los MENSUALES. Para un bimestral el
   dato guardado dice el día ("el 15") pero no el mes, y no hay de dónde
   sacarlo: inventar «el 15 del mes que viene» sería mentir la mitad de las
   veces. Para esos, la pantalla enseña «día 15 · cada 2 meses», que es todo lo
   que se sabe. Si un día estorba, la salida limpia es una columna
   `proximo_pago date` de la que se derive TODO (el día sale de la fecha), no un
   segundo campo de mes que se pueda desincronizar con éste. */
export function proximoPago(
  diaPago: number | null,
  periodicidad: PeriodicidadPersonalId,
  hoy: string = hoyISO(),
): string | null {
  if (!diaPago || periodicidad !== "mensual") return null;

  /* El día 31 no existe en febrero: se recorta al último del mes. Es el mismo
     `new Date(anio, mes, 0)` con el que el panel de gastos salta al mes del
     último gasto. */
  const enMes = (anio: number, mes: number) => {
    const ultimo = new Date(anio, mes, 0).getDate();
    const dia = Math.min(diaPago, ultimo);
    return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  };

  const [anio, mes] = hoy.split("-").map(Number);
  const esteMes = enMes(anio, mes);
  /* Si toca hoy, toca hoy: no se empuja al mes siguiente. */
  if (esteMes >= hoy) return esteMes;
  return mes === 12 ? enMes(anio + 1, 1) : enMes(anio, mes + 1);
}

/* ¿Cae dentro de la semana? Se compara como texto contra hoy+7 —las fechas ISO
   se ordenan solas— para no necesitar un helper nuevo en lib/fecha.ts. */
export function esInminente(fecha: string | null, hoy: string = hoyISO()): boolean {
  return !!fecha && fecha >= hoy && fecha <= sumarDias(hoy, 7);
}

/* El siguiente pago con fecha conocida, para la tarjeta de arriba. */
export function siguienteCompromiso(
  compromisos: CompromisoPersonal[],
  hoy: string = hoyISO(),
): { compromiso: CompromisoPersonal; fecha: string } | null {
  return (
    compromisos
      .filter((c) => c.activo)
      .map((c) => ({ compromiso: c, fecha: proximoPago(c.dia_pago, c.periodicidad, hoy) }))
      .filter((x): x is { compromiso: CompromisoPersonal; fecha: string } => x.fecha !== null)
      .sort((a, b) => a.fecha.localeCompare(b.fecha))[0] ?? null
  );
}

/* Reparto del gasto MENSUAL por categoría, en el formato que come <ListaBarras>.
   Se recorre el catálogo y no el mapa para conservar su orden y su color, igual
   que el `porCategoria` del panel de gastos. */
export function repartoPorCategoria(
  compromisos: CompromisoPersonal[],
): { id: string; nombre: string; valor: number; color: string }[] {
  const sumas = new Map<string, number>();
  for (const c of compromisos) {
    if (!c.activo) continue;
    sumas.set(c.categoria, (sumas.get(c.categoria) ?? 0) + costoMensual(c.monto, c.periodicidad));
  }
  return CATEGORIAS_PERSONALES.filter((cat) => sumas.has(cat.id))
    .map((cat) => ({
      id: cat.id,
      nombre: cat.nombre,
      valor: Math.round(sumas.get(cat.id)! * 100) / 100,
      color: cat.color,
    }))
    .sort((a, b) => b.valor - a.valor);
}
