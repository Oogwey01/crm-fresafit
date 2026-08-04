/* ============================================================================
   scripts/diagnostico-tiktok.mjs — Qué sabemos de TikTok con datos propios
   ----------------------------------------------------------------------------
   Solo lectura. Dos preguntas:
     1) ¿Las fichas de TikTok comparten inventario con Tienda Nube / Mercado
        Libre, o viven aparte?
     2) De los SKUs que están en los dos lados, ¿coinciden los precios?

   Uso:  node --env-file=.env.local scripts/diagnostico-tiktok.mjs
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

/* PostgREST corta en 1000 filas: se pagina para no leer un recorte y creerlo el total. */
async function todo(tabla, columnas, filtro = (q) => q) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await filtro(admin.from(tabla).select(columnas)).range(
      desde,
      desde + 999,
    );
    if (error) throw new Error(error.message);
    filas.push(...data);
    if (data.length < 1000) return filas;
  }
}

const productos = await todo(
  "products",
  "id, nombre, sku, precio, stock, tiktok_product_id, tiktok_stock, tiendanube_product_id, meli_item_id, activo",
);

const conTikTok = productos.filter((p) => p.tiktok_product_id);
console.log("Productos totales:              ", productos.length);
console.log("Con publicación en TikTok:      ", conTikTok.length);
console.log("  · también en TN o ML:         ", conTikTok.filter((p) => p.tiendanube_product_id || p.meli_item_id).length);
console.log("  · con tiktok_stock no nulo:   ", conTikTok.filter((p) => p.tiktok_stock !== null).length);
console.log("  · activos:                    ", conTikTok.filter((p) => p.activo).length);

/* Mismo SKU en una ficha de TikTok y en otra de los demás canales. */
const porSku = new Map();
for (const p of productos) {
  const sku = p.sku?.trim();
  if (!sku) continue;
  porSku.set(sku, [...(porSku.get(sku) ?? []), p]);
}

let partidos = 0;
const preciosDistintos = [];
for (const [sku, fichas] of porSku) {
  const tt = fichas.filter((p) => p.tiktok_product_id);
  const otras = fichas.filter((p) => !p.tiktok_product_id && (p.tiendanube_product_id || p.meli_item_id));
  if (!tt.length || !otras.length) continue;
  partidos++;

  /* Precio de referencia a cada lado: el primero que lo tenga puesto. */
  const pTT = tt.find((p) => p.precio != null)?.precio;
  const pOtro = otras.find((p) => p.precio != null)?.precio;
  if (pTT != null && pOtro != null && Number(pTT) !== Number(pOtro)) {
    preciosDistintos.push({ sku, tiktok: Number(pTT), otro: Number(pOtro), dif: Number(pTT) - Number(pOtro) });
  }
}

console.log("\nSKUs partidos (ficha de TikTok + ficha de otro canal):", partidos);
console.log("De esos, con PRECIO distinto entre canales:            ", preciosDistintos.length);

preciosDistintos.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
for (const p of preciosDistintos.slice(0, 12)) {
  const signo = p.dif > 0 ? "más caro" : "más barato";
  console.log(`  ${p.sku.padEnd(14)} TikTok $${p.tiktok}  vs  $${p.otro}   (${signo} en TikTok por $${Math.abs(p.dif).toFixed(2)})`);
}

/* Ventas por canal de los últimos 60 días, para ver el peso de TikTok. */
const desde = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
const ventas = await todo("sales", "canal, producto_id, cantidad, monto, fecha", (q) =>
  q.gte("fecha", desde).or("estado.is.null,estado.neq.cancelado"),
);
const porCanal = new Map();
for (const v of ventas) {
  const c = porCanal.get(v.canal) ?? { ventas: 0, piezas: 0, monto: 0 };
  c.ventas++;
  c.piezas += v.cantidad || 0;
  c.monto += Number(v.monto || 0);
  porCanal.set(v.canal, c);
}
console.log(`\nVentas por canal (últimos 60 días, desde ${desde}):`);
for (const [canal, c] of [...porCanal.entries()].sort((a, b) => b[1].monto - a[1].monto)) {
  console.log(`  ${canal.padEnd(15)} ${String(c.ventas).padStart(5)} renglones · ${String(c.piezas).padStart(5)} pzas · $${c.monto.toFixed(2)}`);
}
