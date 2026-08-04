/* ============================================================================
   scripts/probar-comisiones-ml.mjs — Qué nos cobra Mercado Libre por vender
   ----------------------------------------------------------------------------
   Solo lectura. El CRM guarda de cada orden lo que pagó el comprador, pero no
   lo que se queda la plataforma. En Mercado Libre esa cifra viaja dentro de la
   propia orden (a diferencia de TikTok, que la entrega en cortes aparte), así
   que no hace falta un endpoint nuevo: hace falta saber en qué campo viene.

   Este script vuelca los campos de importe de órdenes reales para encontrarlo.

   Uso:  node --env-file=.env.local scripts/probar-comisiones-ml.mjs
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";

const API = "https://api.mercadolibre.com";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: fila } = await admin
  .from("integraciones")
  .select("access_token, external_id")
  .eq("id", "mercadolibre")
  .maybeSingle();
const token = fila.access_token;

async function ml(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const busq = await ml(`/orders/search?seller=${fila.external_id}&sort=date_desc&limit=5`);
const ordenes = busq.json?.results ?? [];
console.log("órdenes recientes:", ordenes.length);

for (const resumen of ordenes.slice(0, 3)) {
  /* El detalle completo trae más campos que el listado. */
  const o = (await ml(`/orders/${resumen.id}`)).json;
  console.log(`\n=== orden ${o.id} (${o.status}) ===`);
  console.log("  total_amount:", o.total_amount, "| paid_amount:", o.paid_amount);

  for (const li of o.order_items ?? []) {
    console.log(
      `  línea ${li.item?.id}: unit_price=${li.unit_price} qty=${li.quantity}` +
        ` sale_fee=${li.sale_fee} listing_type=${li.listing_type_id}`,
    );
  }

  for (const p of o.payments ?? []) {
    console.log(
      `  pago ${p.id}: total_paid=${p.total_paid_amount} shipping=${p.shipping_cost}` +
        ` fee=${p.marketplace_fee} taxes=${p.taxes_amount} status=${p.status}`,
    );
  }

  /* Por si la comisión viviera en un recurso aparte. */
  const bill = await ml(`/orders/${o.id}/billing_info`);
  console.log("  billing_info →", bill.status);

  /* Detalle de costos del envío: quién paga el flete. */
  if (o.shipping?.id) {
    const c = (await ml(`/shipments/${o.shipping.id}/costs`)).json;
    console.log("  ENVÍO gross_amount:", c?.gross_amount);
    console.log("    receiver (comprador): cost =", c?.receiver?.cost);
    for (const s of c?.senders ?? []) {
      console.log(
        `    sender (vendedor): cost=${s.cost} save=${s.save} compensation=${s.compensation}` +
          ` discounts=${JSON.stringify(s.discounts)} charges=${JSON.stringify(s.charges)}`,
      );
    }
  }
}
