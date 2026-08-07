/* ============================================================================
   scripts/probar-plazos-tiktok.mjs — ¿Qué plazo de despacho manda TikTok?
   ----------------------------------------------------------------------------
   Solo lectura. La tabla de Pedidos pinta un semáforo de plazo ("se pasó el
   plazo" / "vence en horas") que hasta ahora solo veían los pedidos de Mercado
   Libre: `sales.envio_limite_despacho` únicamente la escribía esa sync. Para
   meter a TikTok en el mismo semáforo hacía falta saber QUÉ campos de plazo
   manda de verdad esta cuenta (región MX) — el tipo `OrdenTikTok` declara un
   puñado de campos y descarta el resto del payload, así que nadie lo sabía.

   Mismo precedente que scripts/probar-envios-ml.mjs, que descubrió que ML NO
   manda `estimated_handling_limit` y obligó a reconstruir el plazo a mano.

   Imprime el payload CRUDO de unas órdenes pendientes, compara el formato del
   listado contra el del detalle, e inventaría las claves que huelen a plazo
   (sla / due / _time / rts / collection / deliver) con su hora de México, para
   poder cotejarlas contra el "Enviar antes de" del Seller Center.

   LO QUE ENCONTRÓ (tienda real, 06/08/2026), y de donde sale el mapeo que hoy
   usa lib/tiktok/ventas.ts:
     * `rts_sla_time` — en 6/6 de las pendientes. Es el PLAZO DE DESPACHO: cae
       siempre a las 23:59:59 hora de México (el día límite completo), en general
       el día siguiente a la compra.
     * `rts_time` — en 10/10 de las AWAITING_COLLECTION / IN_TRANSIT / DELIVERED
       y en NINGUNA pendiente. Es la salida real.
     * `tts_sla_time` — el plazo de ENTREGA (3-5 días después), no de despacho.
     * `collection_due_time`, idéntico a `cancel_order_sla_time` — el tope tardío
       de recolección, a once días: no sirve para decidir qué empacar.
     * `shipping_due_time` NO llega, pese a la documentación de TikTok.

   OJO: .env.local apunta a la base de PRODUCCIÓN y el token es el real de la
   tienda. Este script solo LEE: ninguna llamada de escritura.

   Uso:  node --env-file=.env.local scripts/probar-plazos-tiktok.mjs
   ============================================================================ */

import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const API = "https://open-api.tiktokglobalshop.com";
const DIAS_VENTANA = 30;
/* Cuántas órdenes se imprimen enteras. Con dos o tres se ve el patrón; más es
   ruido en la terminal. */
const A_DETALLE = 3;

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
if (!fila) {
  console.error("TikTok Shop no está conectado.");
  process.exit(1);
}
const cipher = fila.datos?.shop_cipher ?? "";

/* Misma firma que lib/tiktok/api.ts, con el body dentro: es lo que cambia
   respecto de los sondeos anteriores, porque el buscador de órdenes es POST. */
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

async function tt(metodo, path, { query = {}, body = null } = {}) {
  const cuerpo = body ? JSON.stringify(body) : null;
  const q = {
    app_key: process.env.TIKTOK_APP_KEY ?? "",
    timestamp: String(Math.floor(Date.now() / 1000)),
    shop_cipher: cipher,
    ...query,
  };
  q.sign = firmar(path, q, cuerpo);
  const res = await fetch(`${API}${path}?${new URLSearchParams(q)}`, {
    method: metodo,
    headers: { "x-tts-access-token": fila.access_token, "Content-Type": "application/json" },
    body: cuerpo,
  });
  const json = await res.json().catch(() => null);
  return { http: res.status, code: json?.code, message: json?.message, data: json?.data };
}

const desde = Math.floor(Date.now() / 1000) - DIAS_VENTANA * 86400;
const PENDIENTES = new Set(["AWAITING_SHIPMENT", "AWAITING_COLLECTION"]);

/* Primero se prueba el filtro por estado (ahorra páginas); si la API lo rechaza,
   se cae al listado que ya usa el importador y se filtra aquí. */
let ordenes = [];
let via = "order_status en el body";
let r = await tt("POST", "/order/202309/orders/search", {
  query: { page_size: "50", sort_field: "create_time", sort_order: "DESC" },
  body: { create_time_ge: desde, order_status: "AWAITING_SHIPMENT" },
});
if (r.code === 0 && (r.data?.orders ?? []).length > 0) {
  ordenes = r.data.orders;
} else {
  via = `sin filtro de estado (el filtrado va aquí) — code ${r.code}: ${r.message ?? ""}`;
  r = await tt("POST", "/order/202309/orders/search", {
    query: { page_size: "50", sort_field: "create_time", sort_order: "DESC" },
    body: { create_time_ge: desde },
  });
  if (r.code !== 0) {
    console.error("No se pudieron listar órdenes:", r.http, r.code, r.message);
    process.exit(1);
  }
  ordenes = (r.data?.orders ?? []).filter((o) => PENDIENTES.has(o.status));
}

console.log(`\nVentana: ${DIAS_VENTANA} días · vía: ${via}`);
console.log(`Órdenes pendientes (AWAITING_*): ${ordenes.length}`);
if (ordenes.length === 0) {
  console.log("Sin pendientes en la ventana: no hay plazo vivo que mirar. Amplía DIAS_VENTANA.");
  process.exit(0);
}

/* ---------------------- 1. Payload crudo del listado ---------------------- */

console.log("\n=============== PAYLOAD CRUDO (listado) ===============");
for (const o of ordenes.slice(0, A_DETALLE)) {
  console.log(`\n--- orden ${o.id} · ${o.status} ---`);
  console.log(JSON.stringify(o, null, 2));
}

/* ----------------- 2. El detalle, ¿trae más que el listado? --------------- */

console.log("\n=============== PAYLOAD CRUDO (detalle por id) ===============");
for (const o of ordenes.slice(0, A_DETALLE)) {
  const d = await tt("GET", "/order/202309/orders", { query: { ids: o.id } });
  const det = d.data?.orders?.[0];
  if (!det) {
    console.log(`\n--- orden ${o.id}: sin detalle (code ${d.code}: ${d.message ?? ""}) ---`);
    continue;
  }
  console.log(`\n--- orden ${o.id} ---`);
  console.log(JSON.stringify(det, null, 2));
  const enListado = new Set(Object.keys(o));
  const enDetalle = new Set(Object.keys(det));
  console.log(
    "Claves solo en el DETALLE:",
    Object.keys(det).filter((k) => !enListado.has(k)).join(", ") || "—",
  );
  console.log(
    "Claves solo en el LISTADO:",
    Object.keys(o).filter((k) => !enDetalle.has(k)).join(", ") || "—",
  );
}

/* -------------- 3. Inventario de claves que huelen a plazo ---------------- */

const CANDIDATA = /sla|due|_time$|rts|collection|deliver/i;

function inventariar(lista) {
  const conteo = new Map(); // clave → { veces, ejemplo }
  for (const o of lista) {
    for (const [k, v] of Object.entries(o)) {
      if (!CANDIDATA.test(k)) continue;
      const c = conteo.get(k) ?? { veces: 0, ejemplo: v };
      c.veces += 1;
      /* Se guarda el primer ejemplo con valor: los campos que aún no aplican
         llegan en 0 y un 0 no dice nada. */
      if (!c.ejemplo) c.ejemplo = v;
      conteo.set(k, c);
    }
  }
  return conteo;
}

const enMX = (seg) =>
  typeof seg === "number" && seg > 0
    ? new Date(seg * 1000).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })
    : "—";

function imprimirInventario(conteo, total) {
  for (const [k, c] of [...conteo.entries()].sort((a, b) => b[1].veces - a[1].veces)) {
    const veces = `${String(c.veces).padStart(3)}/${total}`;
    console.log(`${k.padEnd(24)} en ${veces}  ej: ${String(c.ejemplo).padEnd(12)} → ${enMX(c.ejemplo)}`);
  }
}

const conteo = inventariar(ordenes);
console.log(`\n=============== CLAVES CANDIDATAS (de ${ordenes.length} órdenes) ===============`);
imprimirInventario(conteo, ordenes.length);

/* --------- 4. Fila por orden: es lo que se coteja con el panel ------------ */

console.log("\n=============== POR ORDEN (hora de México) ===============");
console.log("Compara estas horas con el 'Enviar antes de' que muestra el Seller");
console.log("Center para la misma orden: eso decide cuál campo es el plazo.\n");
const claves = [...conteo.keys()];
for (const o of ordenes.slice(0, 10)) {
  console.log(`orden ${o.id} · ${o.status} · creada ${enMX(o.create_time)}`);
  for (const k of claves) console.log(`    ${k.padEnd(24)} ${String(o[k] ?? "—").padEnd(12)} ${enMX(o[k])}`);
  console.log("");
}

/* --------- 5. La otra mitad: ¿qué campo dice cuándo SALIÓ de verdad? ------ */

/* El semáforo necesita dos datos: el plazo y la salida real (sin ella, un pedido
   despachado a tiempo se quedaría marcado como pendiente para siempre). En las
   órdenes AWAITING_SHIPMENT ese campo todavía no existe, así que hay que ir a
   mirar las que ya pasaron por ahí. */
const YA_DESPACHADAS = ["AWAITING_COLLECTION", "IN_TRANSIT", "DELIVERED"];

console.log("\n=============== ÓRDENES YA DESPACHADAS ===============");
for (const estado of YA_DESPACHADAS) {
  const res = await tt("POST", "/order/202309/orders/search", {
    query: { page_size: "10", sort_field: "create_time", sort_order: "DESC" },
    body: { create_time_ge: desde, order_status: estado },
  });
  const lista = res.data?.orders ?? [];
  console.log(`\n--- ${estado}: ${lista.length} en la ventana ---`);
  if (lista.length === 0) continue;

  const inv = inventariar(lista);
  imprimirInventario(inv, lista.length);
  /* Las claves que NO estaban en las pendientes: ahí vive la salida real. */
  const nuevas = [...inv.keys()].filter((k) => !conteo.has(k));
  console.log("Claves que aparecen SOLO aquí:", nuevas.join(", ") || "—");
}
