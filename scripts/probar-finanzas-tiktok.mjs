/* ============================================================================
   scripts/probar-finanzas-tiktok.mjs — Qué SÍ nos deja ver TikTok hoy
   ----------------------------------------------------------------------------
   Solo lectura. El token vigente trae, entre otros, `seller.finance.info` y
   `data.bestselling.public.read`, dos permisos que el CRM no está usando. El
   primero abre lo que TikTok nos cobra y nos liquida por cada venta —el costo
   real del canal, que hoy no aparece por ningún lado—; el segundo, lo que más
   se vende en la plataforma.

   Este script sondea las rutas de esas dos familias para ver cuáles responden
   con los permisos actuales, antes de escribir código contra ellas.

   Uso:  node --env-file=.env.local scripts/probar-finanzas-tiktok.mjs
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
  .select("access_token, external_id, datos")
  .eq("id", "tiktok")
  .maybeSingle();
const cipher = fila?.datos?.shop_cipher ?? "";

function firmar(path, query) {
  const secret = process.env.TIKTOK_APP_SECRET ?? "";
  const p = { ...query };
  delete p.sign;
  delete p.access_token;
  let s = path;
  for (const k of Object.keys(p).sort()) s += `${k}${p[k]}`;
  return createHmac("sha256", secret).update(secret + s + secret).digest("hex");
}

async function probar(path, extra = {}) {
  const query = {
    app_key: process.env.TIKTOK_APP_KEY ?? "",
    timestamp: String(Math.floor(Date.now() / 1000)),
    shop_cipher: cipher,
    ...extra,
  };
  query.sign = firmar(path, query);
  const res = await fetch(`${API}${path}?${new URLSearchParams(query)}`, {
    headers: { "x-tts-access-token": fila.access_token, "Content-Type": "application/json" },
  });
  const json = await res.json().catch(() => null);
  return { http: res.status, code: json?.code, message: json?.message, data: json?.data };
}

const seg = (n) => String(Math.floor(Date.now() / 1000) - n * 86400);

/* `payments` y `statements` respondieron "SortField is a required field": el
   permiso está y solo faltaba el criterio de orden. Se prueban los nombres
   plausibles del campo hasta dar con el que acepta. */
const rutas = [
  ["/finance/202309/statements", { page_size: "5", sort_field: "statement_time", sort_order: "DESC" }],
  ["/finance/202309/statements", { page_size: "5", sort_field: "statement_time" }],
  ["/finance/202309/payments", { page_size: "5", sort_field: "create_time", sort_order: "DESC" }],
  ["/finance/202309/payments", { page_size: "5", sort_field: "paid_time" }],
  ["/finance/202309/withdrawals", { page_size: "5", types: "WITHDRAW" }],
];

console.log("ruta                                                    http  code      mensaje");
for (const [path, extra] of rutas) {
  const r = await probar(path, extra);
  console.log(
    `${path.padEnd(55)} ${String(r.http).padEnd(5)} ${String(r.code ?? "-").padEnd(9)} ${(r.message ?? "").slice(0, 60)}`,
  );
  if (r.code === 0) console.log("      DATA:", JSON.stringify(r.data).slice(0, 700));
}

/* Liquidación de una orden concreta: es el dato más útil de finanzas, porque
   dice cuánto quedó neto de una venta que ya tenemos en el CRM. */
const { data: venta } = await admin
  .from("sales")
  .select("referencia_externa")
  .eq("canal", "tiktok_shop")
  .not("referencia_externa", "is", null)
  .order("fecha", { ascending: false })
  .limit(1)
  .maybeSingle();

if (venta?.referencia_externa) {
  const orden = venta.referencia_externa.split(":")[0];
  console.log(`\nLiquidación de la orden ${orden}:`);
  for (const path of [
    `/finance/202309/orders/${orden}/settlements`,
    `/finance/202501/orders/${orden}/settlements`,
  ]) {
    const r = await probar(path);
    console.log(`  ${path.padEnd(58)} http ${r.http} code ${r.code ?? "-"} ${(r.message ?? "").slice(0, 50)}`);
    if (r.code === 0) console.log("      DATA:", JSON.stringify(r.data).slice(0, 700));
  }
}
