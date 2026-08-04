/* ============================================================================
   scripts/probar-envios-ml.mjs — ¿Qué trae de verdad /shipments de ML?
   ----------------------------------------------------------------------------
   Solo lectura. El tablero de despacho necesita dos campos del envío: la hora
   límite para entregarle el paquete al transportista y la hora real de salida.
   La documentación dice que el recurso responde en dos formatos según se mande
   o no la cabecera `x-format-new: true`, y de eso depende si esos campos
   llegan. Este script compara ambas respuestas sobre envíos reales.

   Uso:  node --env-file=.env.local scripts/probar-envios-ml.mjs
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
  .select("access_token, external_id, expires_at")
  .eq("id", "mercadolibre")
  .maybeSingle();
if (!fila) {
  console.error("Mercado Libre no está conectado.");
  process.exit(1);
}
const token = fila.access_token;

async function ml(path, cabeceras = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...cabeceras },
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/* Órdenes recientes: interesan las que aún no se entregan, que son las que
   tienen plazo de despacho vivo. */
const ordenes = await ml(`/orders/search?seller=${fila.external_id}&sort=date_desc&limit=30`);
if (ordenes.status !== 200) {
  console.error("No se pudieron listar órdenes:", ordenes.status, JSON.stringify(ordenes.json).slice(0, 300));
  process.exit(1);
}
const conEnvio = (ordenes.json.results ?? []).filter((o) => o.shipping?.id);
console.log(`Órdenes recientes: ${ordenes.json.results?.length ?? 0} · con envío: ${conEnvio.length}`);
console.log("Etiquetas de las 5 más recientes:", conEnvio.slice(0, 5).map((o) => (o.tags ?? []).join("/") || "—"));

function resumir(envio) {
  if (!envio) return "sin cuerpo";
  return {
    status: envio.status,
    substatus: envio.substatus,
    limite_despacho: envio.shipping_option?.estimated_handling_limit?.date ?? null,
    date_shipped: envio.status_history?.date_shipped ?? null,
    tiene_shipping_option: !!envio.shipping_option,
    tiene_status_history: !!envio.status_history,
    claves: Object.keys(envio).slice(0, 22),
  };
}

for (const o of conEnvio.slice(0, 3)) {
  const id = o.shipping.id;
  console.log(`\n=== envío ${id} (orden ${o.id}, estado ${o.status}) ===`);

  const viejo = await ml(`/shipments/${id}`);
  console.log("SIN x-format-new →", viejo.status, "| status:", viejo.json?.status);
  console.log("   shipping_option:", JSON.stringify(viejo.json?.shipping_option ?? null).slice(0, 700));
  console.log("   status_history :", JSON.stringify(viejo.json?.status_history ?? null).slice(0, 500));

  const nuevo = await ml(`/shipments/${id}`, { "x-format-new": "true" });
  console.log("CON x-format-new →", nuevo.status);
  console.log("   lead_time:", JSON.stringify(nuevo.json?.lead_time ?? null).slice(0, 900));

  /* El recurso dedicado al plazo, por si ninguno de los dos lo trae. */
  const lead = await ml(`/shipments/${id}/lead_time`);
  console.log("lead_time →", lead.status);
  if (lead.status === 200) {
    console.log(
      "  ",
      JSON.stringify(
        {
          estimated_handling_limit: lead.json?.estimated_handling_limit ?? null,
          estimated_delivery_limit: lead.json?.estimated_delivery_limit ?? null,
          claves: Object.keys(lead.json ?? {}).slice(0, 20),
        },
        null,
        1,
      ),
    );
  }
}
