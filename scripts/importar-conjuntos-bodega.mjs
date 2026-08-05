/* ============================================================================
   scripts/importar-conjuntos-bodega.mjs
   ----------------------------------------------------------------------------
   Carga los ~84 conjuntos del Sheet «FRESA FIT - Bodega» (bloque CONJUNTOS) a
   las tablas `conjuntos` y `conjunto_componentes`.

   EL PROBLEMA QUE RESUELVE:
   La hoja y el CRM no hablan el mismo idioma de SKU. La hoja llama al cinturón
   de un conjunto `HEB001CHM`; en el catálogo ese cinturón es `PRM001CH` y
   `PRM001M` (dos fichas, una por talla). Los SKU de muñequeras y straps la hoja
   directamente no los trae: solo el nombre del diseño.

   Así que los componentes se resuelven POR NOMBRE contra el catálogo, acotando
   por el prefijo del SKU según el rol:

     PRM… cinturón de hebilla · SBD… cinturón de powerlift
     MQR… muñequeras          · STR… straps

   Cuando el nombre resuelve a UNA sola ficha se liga (`producto_id`) y la
   columna «armables» de la pantalla puede calcularse. Cuando resuelve a varias
   —lo normal en las tallas CHM y GEG, que en el catálogo son dos fichas— o a
   ninguna, se guarda el nombre y se deja SIN ligar: la pantalla muestra «—» en
   vez de inventar un número. Al final el script dice cuántos quedaron así.

   Uso (Node 20+):
     # 1. Ver el plan sin tocar nada.
     node --env-file=.env.local scripts/importar-conjuntos-bodega.mjs --archivo conjuntos.json
     # 2. Ejecutarlo.
     node --env-file=.env.local scripts/importar-conjuntos-bodega.mjs --archivo conjuntos.json --ejecutar

   `--archivo` es un JSON con las filas del bloque CONJUNTOS de la hoja:
     [{ sku, titulo, categoria, talla, sku_cinturon, cinturon, munequeras, straps }, …]

   Idempotente: los conjuntos que ya existan (mismo SKU) se omiten.

   Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function leerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const clave = argv[i].slice(2);
    const sig = argv[i + 1];
    if (sig && !sig.startsWith("--")) {
      args[clave] = sig;
      i++;
    } else args[clave] = true;
  }
  return args;
}

const args = leerArgs(process.argv.slice(2));
const EJECUTAR = args.ejecutar === true;

if (!args.archivo || args.archivo === true || !existsSync(args.archivo)) {
  console.error("Falta --archivo con el JSON de los conjuntos de la hoja.");
  process.exit(1);
}
const filas = JSON.parse(readFileSync(args.archivo, "utf8"));

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

/* Catálogo completo: PostgREST corta en 1000 filas sin avisar. */
let productos = [];
for (let desde = 0; ; desde += 1000) {
  const { data, error } = await admin
    .from("products")
    .select("id, sku, nombre, stock")
    .range(desde, desde + 999);
  if (error) {
    console.error("No se pudo leer el catálogo:", error.message);
    process.exit(1);
  }
  productos.push(...data);
  if (data.length < 1000) break;
}

const norm = (s) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const palabras = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/* Qué prefijo de SKU tiene cada rol en el catálogo del CRM. */
const PREFIJO = {
  cinturon_hebilla: /^PRM/i,
  cinturon_powerlift: /^SBD/i,
  munequeras: /^MQR/i,
  straps: /^STR/i,
};
/* La talla del conjunto agrupa tallas del catálogo: «CHM» son CH y M. */
const TALLAS = { CHM: ["CH", "M"], G: ["G"], EG: ["EG"], GEG: ["G", "EG"] };

function candidatos(nombre, clave, talla) {
  const ws = palabras(nombre);
  if (!ws.length) return [];
  const rx = PREFIJO[clave];
  /* Muñequeras y straps son talla única: filtrarlos por talla los descartaba
     todos. Solo el cinturón lleva sufijo de talla en el SKU. */
  const sufijos = clave.startsWith("cinturon") ? (TALLAS[talla] ?? []) : null;
  return productos.filter((p) => {
    if (!rx.test(p.sku ?? "")) return false;
    if (!ws.every((w) => norm(p.nombre).includes(w))) return false;
    if (!sufijos?.length) return true;
    return sufijos.includes((p.sku ?? "").replace(/^[A-Za-z]+\d+/, "").toUpperCase());
  });
}

/* --- Plan ---------------------------------------------------------------- */

const { data: yaExisten } = await admin.from("conjuntos").select("sku");
const vistos = new Set((yaExisten ?? []).map((c) => String(c.sku).toUpperCase()));

const plan = [];
const resumen = { ligados: 0, ambiguos: 0, sinMatch: 0 };

for (const f of filas) {
  const sku = (f.sku ?? "").trim().toUpperCase();
  if (!sku || !(f.titulo ?? "").trim()) continue;
  if (vistos.has(sku)) continue;
  vistos.add(sku);

  const claveCint = /HEBILLA/i.test(f.categoria ?? "")
    ? "cinturon_hebilla"
    : "cinturon_powerlift";

  const componentes = [];
  for (const [rol, nombre, clave, skuHoja] of [
    ["cinturon", f.cinturon, claveCint, f.sku_cinturon],
    ["munequeras", f.munequeras, "munequeras", f.sku_munequeras],
    ["straps", f.straps, "straps", f.sku_straps],
  ]) {
    if (!(nombre ?? "").trim()) continue;
    const hits = candidatos(nombre, clave, f.talla);

    if (hits.length === 1) resumen.ligados++;
    else if (hits.length > 1) resumen.ambiguos++;
    else resumen.sinMatch++;

    componentes.push({
      rol,
      /* Se liga solo cuando no hay duda. Con varios candidatos la pantalla
         muestra «—» en armables, que es la verdad: no se sabe cuál es. */
      producto_id: hits.length === 1 ? hits[0].id : null,
      /* Lo más identificable que se tenga, en este orden: el SKU resuelto, el
         que traía la hoja, o el nombre del diseño con su rol por delante (para
         que tres componentes del mismo nombre no choquen entre sí). */
      sku_componente:
        hits.length === 1
          ? hits[0].sku
          : (skuHoja ?? "").trim() || `${rol.toUpperCase()}·${nombre.trim()}`,
      cantidad: 1,
      candidatos: hits.length,
    });
  }

  plan.push({
    sku,
    titulo: (f.titulo ?? "").trim(),
    categoria: (f.categoria ?? "").trim() || null,
    talla: (f.talla ?? "").trim() || null,
    componentes,
  });
}

console.log(`Conjuntos en la hoja:   ${filas.length}`);
console.log(`Nuevos para el CRM:     ${plan.length}`);
console.log(`\nComponentes:`);
console.log(`  ligados a una ficha:  ${resumen.ligados}`);
console.log(`  con varios candidatos:${String(resumen.ambiguos).padStart(4)}  (quedan sin ligar)`);
console.log(`  sin ninguno:          ${resumen.sinMatch}  (quedan sin ligar)`);

console.log("\nPrimeros 5:");
for (const c of plan.slice(0, 5)) {
  console.log(`  ${c.sku.padEnd(11)} ${c.titulo.slice(0, 48).padEnd(50)} ${c.talla ?? ""}`);
  for (const comp of c.componentes) {
    const marca = comp.producto_id ? "ligado " : comp.candidatos > 1 ? "ambiguo" : "sin ficha";
    console.log(`       ${comp.rol.padEnd(11)} ${marca.padEnd(10)} ${comp.sku_componente}`);
  }
}

if (!EJECUTAR) {
  console.log("\n(Prueba en seco: no se guardó nada. Repite con --ejecutar.)");
  process.exit(0);
}

/* --- Ejecutar ------------------------------------------------------------ */

if (!plan.length) {
  console.log("\nNada nuevo que guardar.");
  process.exit(0);
}

const { data: creados, error } = await admin
  .from("conjuntos")
  .insert(
    plan.map((c) => ({ sku: c.sku, titulo: c.titulo, categoria: c.categoria, talla: c.talla })),
  )
  .select("id, sku");
if (error) {
  console.error("\nNo se pudieron crear los conjuntos:", error.message);
  process.exit(1);
}

const idPorSku = new Map(creados.map((c) => [String(c.sku).toUpperCase(), c.id]));
const componentes = plan.flatMap((c) => {
  const id = idPorSku.get(c.sku);
  if (!id) return [];
  return c.componentes.map((comp) => ({
    conjunto_id: id,
    producto_id: comp.producto_id,
    sku_componente: comp.sku_componente,
    rol: comp.rol,
    cantidad: comp.cantidad,
  }));
});

const { error: errComp } = await admin.from("conjunto_componentes").insert(componentes);
if (errComp) {
  console.error("\nLos conjuntos se crearon pero sus componentes no:", errComp.message);
  process.exit(1);
}

console.log(`\nListo: ${creados.length} conjuntos con ${componentes.length} componentes.`);
