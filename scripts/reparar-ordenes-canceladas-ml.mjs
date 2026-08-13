/* ============================================================================
   scripts/reparar-ordenes-canceladas-ml.mjs — Marca el histórico de ML
   ----------------------------------------------------------------------------
   Reparación puntual que acompaña a 20261013000000: las órdenes canceladas
   nunca se marcaban en `sale_orders` y seguían sumando en Métricas. Tienda Nube
   y TikTok se repararon con la sync de ventana ancha (?dias=N), pero la de
   Mercado Libre pide la info de envío POR ORDEN y no cabe en los 300s de
   Vercel. Este script hace solo la parte que faltó:

     1. Busca las órdenes FANTASMA de ML: vivas según `orden_viva` pero sin
        ningún renglón en `sales` (la firma de una cancelación ya procesada).
     2. Verifica cada una contra la API de ML (GET /orders/:id).
     3. Con --aplicar, marca en `sale_orders` las que ML confirma muertas
        (cancelled/invalid). Sin el flag, solo informa.

   El token se LEE de `integraciones` y no se refresca aquí: el refresh de ML es
   de un solo uso y quien lo rota y persiste es la app. Si el token está
   vencido, dispara antes la sync normal (o abre el CRM) y vuelve a correr.

   Las cancelaciones futuras las marca el cron diario con el código nuevo
   (marcarOrdenesRetiradas); este script no hace falta más que una vez.

   Uso (Node 20+ · OJO: .env.local apunta a PRODUCCIÓN):
     node --env-file=.env.local scripts/reparar-ordenes-canceladas-ml.mjs
     node --env-file=.env.local scripts/reparar-ordenes-canceladas-ml.mjs --aplicar
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";

const API = "https://api.mercadolibre.com";
const APLICAR = process.argv.includes("--aplicar");

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE_KEY || URL.includes("placeholder")) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}
const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* Espejo de public.orden_viva() — mantener a la par con 20261013000000. */
const MUERTOS = new Set([
  "cancelled", "canceled", "cancelado", "cancelada",
  "refunded", "reembolsado", "voided", "anulado", "invalid",
]);
const ordenViva = (estado) => estado != null && !MUERTOS.has(estado.trim().toLowerCase());

/* PostgREST corta en ~1000 filas sin avisar: paginar con .range() + orden por id. */
async function traerTodo(arma) {
  const TAM = 1000;
  const filas = [];
  for (let i = 0; ; i += TAM) {
    const { data, error } = await arma().order("id").range(i, i + TAM - 1);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if (!data || data.length < TAM) return filas;
  }
}

const { data: cx } = await admin
  .from("integraciones")
  .select("access_token, expires_at")
  .eq("id", "mercadolibre")
  .maybeSingle();
if (!cx?.access_token) {
  console.error("Mercado Libre no está conectado.");
  process.exit(1);
}
if (cx.expires_at && Date.parse(cx.expires_at) < Date.now()) {
  console.error(
    `El token venció (${cx.expires_at}). Dispara la sync normal para refrescarlo y vuelve a correr.`,
  );
  process.exit(1);
}

const ordenes = await traerTodo(() =>
  admin
    .from("sale_orders")
    .select("id, referencia_orden, fecha, estado, total")
    .eq("canal", "mercado_libre"),
);
const renglones = await traerTodo(() =>
  admin
    .from("sales")
    .select("id, referencia_externa")
    .eq("canal", "mercado_libre")
    .eq("origen", "api"),
);
const conRenglon = new Set(renglones.map((r) => (r.referencia_externa ?? "").split(":")[0]));

const fantasmas = ordenes.filter(
  (o) => ordenViva(o.estado) && !conRenglon.has(o.referencia_orden),
);
console.log(
  `Órdenes ML: ${ordenes.length} · fantasmas (vivas sin renglones): ${fantasmas.length}\n`,
);

let confirmadas = 0;
let vivasDeVerdad = 0;
const pesos = (n) => Number(n ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

for (const o of fantasmas) {
  const res = await fetch(`${API}/orders/${o.referencia_orden}`, {
    headers: { Authorization: `Bearer ${cx.access_token}`, Accept: "application/json" },
  });
  const cuerpo = await res.json().catch(() => null);
  if (res.status !== 200) {
    console.log(`  ? #${o.referencia_orden}  ${o.fecha}  → HTTP ${res.status}, se deja como está`);
    continue;
  }
  const status = String(cuerpo?.status ?? "").toLowerCase();
  const muerta = status === "cancelled" || status === "invalid";
  const rotulo = muerta ? "✗ muerta" : "✓ viva ";
  console.log(
    `  ${rotulo} #${o.referencia_orden}  ${o.fecha}  ${pesos(o.total).padStart(12)}  ML dice: ${status}`,
  );
  if (!muerta) {
    vivasDeVerdad++;
    continue;
  }
  confirmadas++;
  if (APLICAR) {
    const { error } = await admin
      .from("sale_orders")
      .update({ estado: status === "invalid" ? "invalid" : "cancelled" })
      .eq("id", o.id);
    if (error) throw new Error(error.message);
  }
}

const total = fantasmas.reduce((a, o) => a + (Number(o.total) || 0), 0);
console.log(
  `\n${confirmadas} confirmadas muertas por ML · ${vivasDeVerdad} vivas de verdad · ` +
    `${pesos(total)} en fantasmas revisados`,
);
console.log(
  APLICAR
    ? "Cambios APLICADOS en sale_orders."
    : "Modo informe (nada se escribió). Corre con --aplicar para marcar.",
);
