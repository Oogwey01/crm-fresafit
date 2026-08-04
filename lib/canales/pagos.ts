/* ============================================================================
   lib/canales/pagos.ts — Cómo paga la gente y con qué cupón
   ----------------------------------------------------------------------------
   Los datos de pago vienen dentro de cada orden del canal y se archivan en
   `sale_orders`. Hoy solo Tienda Nube los manda; en el resto llegan nulos y
   simplemente no entran en el conteo.

   La agregación vive aquí porque la piden dos pantallas —el bloque de
   plataformas en Métricas y la página de Tienda Nube en Canales— y llevaba
   camino de escribirse dos veces.
   ============================================================================ */

import type { OrdenMetricas } from "@/lib/types";

export type FormaDePago = { metodo: string; cantidad: number; monto: number };
export type UsoCupon = { codigo: string; usos: number; descuento: number };

export type ResumenPagos = {
  /* De la forma más usada a la menos. */
  pagos: FormaDePago[];
  cupones: UsoCupon[];
  /* Órdenes pagadas a mensualidades. */
  aMeses: number;
  /* Sobre cuántas órdenes se calculó: las que traen medio de pago. Es el
     denominador honesto, porque las que no lo traen no son "efectivo": son
     canales que no reportan el dato. */
  conDatoDePago: number;
};

export function resumirPagos(ordenes: OrdenMetricas[]): ResumenPagos {
  const pagos = new Map<string, FormaDePago>();
  const cupones = new Map<string, UsoCupon>();
  let aMeses = 0;
  let conDatoDePago = 0;

  for (const o of ordenes) {
    if (o.metodo_pago) {
      const p = pagos.get(o.metodo_pago) ?? { metodo: o.metodo_pago, cantidad: 0, monto: 0 };
      p.cantidad++;
      p.monto += Number(o.total || 0);
      pagos.set(o.metodo_pago, p);
      conDatoDePago++;
      if ((o.meses ?? 1) > 1) aMeses++;
    }
    if (o.cupon) {
      const c = cupones.get(o.cupon) ?? { codigo: o.cupon, usos: 0, descuento: 0 };
      c.usos++;
      c.descuento += Number(o.descuento || 0);
      cupones.set(o.cupon, c);
    }
  }

  return {
    pagos: [...pagos.values()].sort((a, b) => b.cantidad - a.cantidad),
    cupones: [...cupones.values()].sort((a, b) => b.usos - a.usos),
    aMeses,
    conDatoDePago,
  };
}
