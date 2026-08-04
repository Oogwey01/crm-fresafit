/* ============================================================================
   scripts/probar-analytics-tiktok.mjs — ¿Nos deja TikTok ver sus analíticas?
   ----------------------------------------------------------------------------
   Solo lectura. La familia /analytics/... de TikTok Shop (GMV por video, por
   LIVE, por producto) necesita el permiso `data.shop_analytics.public.read`,
   que se concede al autorizar la app. Este script pregunta a la API en vez de
   suponerlo: distingue "no tenemos permiso" de "el parámetro va de otra forma",
   que llevan a decisiones opuestas.

   Uso:  node --env-file=.env.local scripts/probar-analytics-tiktok.mjs
   ============================================================================ */

import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const API = "https://open-api.tiktokglobalshop.com";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: fila } = await admin
  .from("integraciones")
  .select("access_token, external_id, expires_at, datos")
  .eq("id", "tiktok")
  .maybeSingle();

if (!fila) {
  console.error("TikTok no está conectado.");
  process.exit(1);
}
const cipher = fila.datos?.shop_cipher ?? "";
const vencido = fila.expires_at && Date.parse(fila.expires_at) < Date.now();
console.log("shop:", fila.external_id, "| token vence:", fila.expires_at, vencido ? "(VENCIDO)" : "");

function firmar(path, query, body) {
  const secret = process.env.TIKTOK_APP_SECRET ?? "";
  const p = { ...query };
  delete p.sign;
  delete p.access_token;
  let s = path;
  for (const k of Object.keys(p).sort()) s += `${k}${p[k]}`;
  if (body) s += body;
  return createHmac("sha256", secret).update(secret + s + secret).digest("hex");
}

async function probar(path, extra = {}) {
  const query = {
    app_key: process.env.TIKTOK_APP_KEY ?? "",
    timestamp: String(Math.floor(Date.now() / 1000)),
    shop_cipher: cipher,
    ...extra,
  };
  query.sign = firmar(path, query, null);
  const res = await fetch(`${API}${path}?${new URLSearchParams(query)}`, {
    headers: { "x-tts-access-token": fila.access_token, "Content-Type": "application/json" },
  });
  const json = await res.json().catch(() => null);
  return { http: res.status, code: json?.code, message: json?.message, data: json?.data };
}

/* Ventana de los últimos 7 días en el formato de fecha que pide la API. */
const dia = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const rango = { start_date_ge: dia(8), end_date_lt: dia(1), currency: "LOCAL" };

const candidatos = [
  ["/analytics/202508/shop/performance", rango],
  ["/analytics/202508/shop_videos/performance", { ...rango, page_size: "5" }],
  ["/analytics/202508/shop_lives/overview_performance", rango],
  ["/analytics/202508/shop_products/performance", { ...rango, page_size: "5" }],
  ["/analytics/202405/shop/performance", rango],
  ["/analytics/202409/shop_videos/performance", { ...rango, page_size: "5" }],
];

console.log("\npath                                             http  code      mensaje");
for (const [path, extra] of candidatos) {
  try {
    const r = await probar(path, extra);
    console.log(
      `${path.padEnd(48)} ${String(r.http).padEnd(5)} ${String(r.code ?? "-").padEnd(9)} ${(r.message ?? "").slice(0, 70)}`,
    );
    if (r.code === 0) console.log("      DATA:", JSON.stringify(r.data).slice(0, 600));
  } catch (e) {
    console.log(`${path.padEnd(48)} ERROR ${e.message.slice(0, 60)}`);
  }
}

console.log(
  "\nCómo leerlo: code 0 = funciona. Un error de PARÁMETRO significa que el permiso sí está" +
    " y solo hay que ajustar la llamada. Un error de permiso/scope significa que hay que" +
    " volver a autorizar la app con `data.shop_analytics.public.read`.",
);
