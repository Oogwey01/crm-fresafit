/* ============================================================================
   scripts/probar-cuadre-ordenes.mjs — Cuadre de sale_orders contra sales
   ----------------------------------------------------------------------------
   Reproduce el diagnóstico del descuadre de Métricas (20261013000000):

     a) Inventario de estados de `sale_orders` en el rango (¿quedan mayúsculas?
        ¿aparecen 'cancelled'/'refunded' tras el backfill?).
     b) Órdenes FANTASMA: vivas según `orden_viva` pero sin ningún renglón en
        `sales` — la firma de una cancelación que no se marcó. (Una orden
        anterior al corte de altas de la primera sync también sale aquí: nunca
        tuvo renglones. En una ventana reciente debe dar ~0.)
     c) Renglones de API cuya orden NO está archivada en `sale_orders` — lo que
        el respaldo por renglones rescata desde que decide por orden.
     d) El bruto por canal con la regla nueva (órdenes vivas + respaldo por
        orden), para pegar junto al panel de cada plataforma.

   Solo LEE. Ojo: .env.local apunta a PRODUCCIÓN.

   Uso (Node 20+):
     node --env-file=.env.local scripts/probar-cuadre-ordenes.mjs \
       --desde=2026-08-04 --hasta=2026-08-10
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE_KEY || URL.includes("placeholder")) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const arg = (nombre, defecto) => {
  const v = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return v ? v.split("=")[1] : defecto;
};
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
const mas = (iso, dias) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
const desde = arg("desde", mas(hoy, -7));
const hasta = arg("hasta", mas(hoy, -1));

const CANALES_API = ["tienda_nube", "mercado_libre", "tiktok_shop"];

/* Espejo de public.orden_viva() — mantener a la par con 20261013000000. */
const MUERTOS = new Set([
  "cancelled", "canceled", "cancelado", "cancelada",
  "refunded", "reembolsado", "voided", "anulado", "invalid",
]);
const ordenViva = (estado) => estado != null && !MUERTOS.has(estado.trim().toLowerCase());

const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* PostgREST corta en ~1000 filas sin avisar: se pagina con .range() y orden de
   criterio único (id), como manda ARQUITECTURA.md. */
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

const pesos = (n) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const refOrden = (referencia_externa) => (referencia_externa ?? "").split(":")[0];

async function main() {
  console.log(`Rango: ${desde} → ${hasta}\n`);

  const ordenes = await traerTodo(() =>
    admin
      .from("sale_orders")
      .select("id, canal, referencia_orden, numero, fecha, estado, total")
      .gte("fecha", desde)
      .lte("fecha", hasta),
  );
  /* Set completo de órdenes archivadas por canal (sin acotar fecha): es el
     probe del respaldo por orden. Solo la llave, para no cargar de más. */
  const archivadas = await traerTodo(() =>
    admin.from("sale_orders").select("id, canal, referencia_orden"),
  );
  const archivo = new Set(archivadas.map((o) => `${o.canal}:${o.referencia_orden}`));

  /* Renglones del rango (con margen de 2 días: la fecha del renglón y la de su
     orden salen del mismo instante, el margen solo cubre reimportes raros). */
  const renglones = await traerTodo(() =>
    admin
      .from("sales")
      .select("id, canal, referencia_externa, fecha, monto, origen, estado")
      .in("canal", CANALES_API)
      .gte("fecha", mas(desde, -2))
      .lte("fecha", mas(hasta, 2)),
  );
  const conRenglon = new Set(
    renglones
      .filter((r) => r.origen === "api")
      .map((r) => `${r.canal}:${refOrden(r.referencia_externa)}`),
  );

  console.log("— (a) Estados de sale_orders en el rango —");
  const porEstado = new Map();
  for (const o of ordenes) {
    const k = `${o.canal} · ${o.estado ?? "∅"}`;
    const v = porEstado.get(k) ?? { n: 0, total: 0 };
    v.n++;
    v.total += Number(o.total) || 0;
    porEstado.set(k, v);
  }
  for (const [k, v] of [...porEstado].sort())
    console.log(`  ${k.padEnd(32)} n=${String(v.n).padStart(4)}  ${pesos(v.total)}`);
  const mayusculas = ordenes.filter((o) => o.estado && o.estado !== o.estado.toLowerCase());
  console.log(
    mayusculas.length
      ? `  ✗ ${mayusculas.length} órdenes con estado en mayúsculas (falta la migración)`
      : "  ✓ sin estados en mayúsculas",
  );

  console.log("\n— (b) Órdenes fantasma (vivas y sin ningún renglón en sales) —");
  const fantasmas = ordenes.filter(
    (o) => ordenViva(o.estado) && !conRenglon.has(`${o.canal}:${o.referencia_orden}`),
  );
  if (fantasmas.length === 0) console.log("  ✓ ninguna");
  for (const canal of CANALES_API) {
    const f = fantasmas.filter((o) => o.canal === canal);
    if (f.length === 0) continue;
    const total = f.reduce((a, o) => a + (Number(o.total) || 0), 0);
    console.log(`  ${canal}: ${f.length} órdenes, ${pesos(total)}`);
    for (const o of f.slice(0, 5))
      console.log(`      #${o.numero ?? o.referencia_orden}  ${o.fecha}  estado=${o.estado}  ${pesos(Number(o.total) || 0)}`);
  }

  console.log("\n— (c) Renglones de API sin orden archivada (los rescata el respaldo) —");
  const sueltos = renglones.filter(
    (r) =>
      r.fecha >= desde &&
      r.fecha <= hasta &&
      r.origen === "api" &&
      (r.estado == null || r.estado !== "cancelado") &&
      !archivo.has(`${r.canal}:${refOrden(r.referencia_externa)}`),
  );
  if (sueltos.length === 0) console.log("  ✓ ninguno (sale_orders cubre todo el rango)");
  for (const canal of CANALES_API) {
    const s = sueltos.filter((r) => r.canal === canal);
    if (s.length === 0) continue;
    const total = s.reduce((a, r) => a + (Number(r.monto) || 0), 0);
    console.log(`  ${canal}: ${s.length} renglones, ${pesos(total)}`);
  }

  console.log("\n— (d) Bruto por canal con la regla nueva (pegar junto al panel) —");
  for (const canal of CANALES_API) {
    const vivas = ordenes.filter((o) => o.canal === canal && ordenViva(o.estado));
    const deOrdenes = vivas.reduce((a, o) => a + (Number(o.total) || 0), 0);
    const deRespaldo = sueltos
      .filter((r) => r.canal === canal)
      .reduce((a, r) => a + (Number(r.monto) || 0), 0);
    console.log(
      `  ${canal.padEnd(14)} ${pesos(deOrdenes + deRespaldo).padStart(14)}` +
        `  (${vivas.length} órdenes${deRespaldo ? ` + ${pesos(deRespaldo)} de respaldo` : ""})`,
    );
  }
}

main().catch((e) => {
  console.error("\nError:", e.message ?? e);
  process.exit(1);
});
