/* ============================================================================
   lib/tiktok/finanzas.ts — Lo que TikTok se queda de cada venta
   ----------------------------------------------------------------------------
   El CRM importa las ventas de TikTok con el precio que pagó el comprador. Lo
   que nunca se registró es cuánto de eso llega de verdad a la cuenta: entre la
   venta y el depósito, TikTok descuenta su comisión y los cargos de envío. En
   los cortes de esta tienda ronda el 22%, así que el canal rinde bastante menos
   de lo que sugiere la cifra de ventas.

   Sale de /finance/202309/statements, que son los cortes de liquidación ya
   pagados. Es de LECTURA y va cacheado: son cortes cerrados, no cambian.

   Solo servidor.
   ============================================================================ */

import { unstable_cache } from "next/cache";
import { conexionTiktok, listarLiquidacionesTikTok } from "@/lib/tiktok/api";

export type FinanzasTikTok = {
  /* Lo que se vendió en los cortes del periodo. */
  venta: number;
  /* Comisión de TikTok, en positivo (la API la manda negativa). */
  comision: number;
  envio: number;
  ajustes: number;
  /* Lo que efectivamente se depositó. */
  depositado: number;
  /* Qué porcentaje de la venta se queda la plataforma. */
  tasa: number;
  cortes: number;
  moneda: string;
  /* Del corte más viejo al más nuevo del periodo (unix en segundos). */
  desde: number | null;
  hasta: number | null;
};

const aNumero = (x: string | null | undefined) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

async function finanzasTikTokSinCache(dias: number): Promise<FinanzasTikTok | null> {
  const cx = await conexionTiktok();
  if (!cx) return null;
  try {
    const desde = Math.floor(Date.now() / 1000) - dias * 86400;
    const cortes = await listarLiquidacionesTikTok(cx, desde);
    if (cortes.length === 0) return null;

    let venta = 0;
    let comision = 0;
    let envio = 0;
    let ajustes = 0;
    let depositado = 0;
    let min = Infinity;
    let max = 0;

    for (const c of cortes) {
      venta += aNumero(c.revenue_amount);
      /* `fee_amount` llega en negativo por ser un cargo; se guarda en positivo
         para poder decir "TikTok se queda X" sin signos que confundan. */
      comision += Math.abs(aNumero(c.fee_amount));
      envio += aNumero(c.shipping_cost_amount);
      ajustes += aNumero(c.adjustment_amount);
      depositado += aNumero(c.settlement_amount);
      min = Math.min(min, c.statement_time);
      max = Math.max(max, c.statement_time);
    }

    return {
      venta: Math.round(venta * 100) / 100,
      comision: Math.round(comision * 100) / 100,
      envio: Math.round(envio * 100) / 100,
      ajustes: Math.round(ajustes * 100) / 100,
      depositado: Math.round(depositado * 100) / 100,
      tasa: venta > 0 ? (comision / venta) * 100 : 0,
      cortes: cortes.length,
      moneda: cortes.find((c) => c.currency)?.currency ?? "MXN",
      desde: Number.isFinite(min) ? min : null,
      hasta: max || null,
    };
  } catch {
    /* Igual que el resto de los canales: si TikTok no contesta, la página se
       pinta sin este bloque en vez de quedarse en blanco. */
    return null;
  }
}

/* Cortes ya cerrados: no vale la pena volver a pedirlos en cada visita. */
export const finanzasTikTok = unstable_cache(finanzasTikTokSinCache, ["tiktok-finanzas"], {
  revalidate: 15 * 60,
  tags: ["canales"],
});
