/* ============================================================================
   scripts/probar-demoras-ml.mjs — ¿Quién dice que un envío salió tarde?
   ----------------------------------------------------------------------------
   Solo lectura. El tablero de despacho derivaba el plazo (hora de entrada a
   preparación + horas de manejo) y con eso marcaba 7 de cada 8 envíos como
   tardíos, cuando la métrica oficial de la cuenta dice 3.9%. Una de las dos
   está mal, y no puede ser la de Mercado Libre.

   Este script pregunta por el recurso que sí es autoritativo —/shipments/{id}/
   delays— y lo contrasta contra la derivación, sobre envíos reales.

   Uso:  node --env-file=.env.local scripts/probar-demoras-ml.mjs
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

const ordenes = await ml(`/orders/search?seller=${fila.external_id}&sort=date_desc&limit=25`);
const conEnvio = (ordenes.json?.results ?? []).filter((o) => o.shipping?.id);

console.log("envío        estado          derivado          /delays");
let coincide = 0;
let derivadosTarde = 0;
let realesTarde = 0;
let sinRecurso = 0;

for (const o of conEnvio.slice(0, 12)) {
  const id = o.shipping.id;
  const env = (await ml(`/shipments/${id}`)).json;
  const del = await ml(`/shipments/${id}/delays`);

  const inicio = env?.status_history?.date_handling;
  const horas = env?.shipping_option?.estimated_delivery_time?.handling;
  const salida = env?.status_history?.date_shipped;
  let derivado = "sin datos";
  if (inicio && typeof horas === "number") {
    const limite = Date.parse(inicio) + horas * 3600000;
    const ref = salida ? Date.parse(salida) : Date.now();
    derivado = ref > limite ? "TARDE" : "a tiempo";
  }

  const tipos = Array.isArray(del.json?.delays) ? del.json.delays.map((d) => d.type) : null;
  const real = del.status !== 200 ? `http ${del.status}` : tipos?.length ? tipos.join(",") : "sin demora";
  if (del.status !== 200) sinRecurso++;
  if (derivado === "TARDE") derivadosTarde++;
  if (tipos?.length) realesTarde++;
  if ((derivado === "TARDE") === !!tipos?.length) coincide++;

  console.log(
    `${String(id).padEnd(12)} ${String(env?.status ?? "?").padEnd(15)} ${derivado.padEnd(17)} ${real}`,
  );
}

console.log(
  `\nDerivación dice TARDE en ${derivadosTarde}; /delays reporta demora en ${realesTarde}.` +
    ` Coinciden ${coincide} de 12. Recurso no disponible en ${sinRecurso}.`,
);
