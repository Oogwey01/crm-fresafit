/* ============================================================================
   scripts/importar-conjuntos-publicados.mjs
   ----------------------------------------------------------------------------
   Da de alta como CONJUNTOS los bundles que ya existen en el catálogo y ya están
   publicados en los canales. Hoy son los diez `CMBMS…` («Baki Manga Muñequeras y
   Straps Combo Pro»), que están en Tienda Nube y Mercado Libre con stock 0
   mientras bodega se prepara para subirlos.

   LA DIFERENCIA CON `importar-conjuntos-bodega.mjs`:
   Aquel leía la hoja de bodega, donde el conjunto es solo texto y NO existe como
   ficha. Éste va al revés: parte de fichas que ya existen, así que el
   `producto_id` del conjunto —dónde se acredita lo que se arme— queda puesto
   desde el nacimiento. Es justo el dato que a los 84 de la hoja les falta.

   CÓMO RESUELVE LAS PIEZAS:
   El nombre de la ficha trae el diseño y las palabras genéricas mezcladas:

     «Baki Manga Muñequeras y Straps Combo Pro»
       diseño → «Baki Manga»    piezas → muñequeras (MQR…) + straps (STR…)

   Se quitan las palabras genéricas, y lo que queda se busca contra el catálogo
   acotando por el prefijo de SKU de cada rol. Cuando el combo dice «Pro» y hay
   varias candidatas, gana la que también dice «Pro» —en el catálogo conviven
   «Muñequeras Akatsuki Pro», «… OG» y «… Logos»—. Si aun así queda más de una,
   el componente se guarda SIN ligar y el script lo reporta al final: es mejor un
   «—» en la pantalla que una receta inventada.

   NO TOCA STOCK. Los combos se quedan en 0, que es lo correcto: su primer stock
   entra por «Armé N» el día que bodega los arme de verdad, y así el ledger
   cuenta esa historia desde el primer renglón.

   Uso (Node 20+):
     # 1. Ver el plan sin tocar nada.
     node --env-file=.env.local scripts/importar-conjuntos-publicados.mjs
     # 2. Ejecutarlo.
     node --env-file=.env.local scripts/importar-conjuntos-publicados.mjs --ejecutar

   Opciones:
     --prefijo CMB   Qué SKU del catálogo son bundles (por defecto CMB).

   Idempotente: los conjuntos que ya existan (mismo SKU) se omiten.
   Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";

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
const PREFIJO_BUNDLE = typeof args.prefijo === "string" ? args.prefijo.toUpperCase() : "CMB";

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
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/* Palabras que describen el ENVOLTORIO, no el diseño. Lo que sobra al quitarlas
   es lo que identifica a la pieza dentro del catálogo. */
const GENERICAS = new Set([
  "munequeras", "straps", "combo", "pro", "set", "kit", "conjunto",
  "gym", "accesorios", "fresafit", "fresa", "fit", "para",
]);

/* Qué prefijo de SKU tiene cada rol en el catálogo del CRM. */
const PREFIJO_ROL = { munequeras: /^MQR/i, straps: /^STR/i };

function palabrasDeDiseno(nombre) {
  return norm(nombre)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !GENERICAS.has(w));
}

function candidatos(diseno, rol, nombreCombo) {
  if (!diseno.length) return [];
  const rx = PREFIJO_ROL[rol];
  const hits = productos.filter(
    (p) => rx.test(p.sku ?? "") && diseno.every((w) => norm(p.nombre).includes(w)),
  );
  if (hits.length <= 1) return hits;

  /* Desempate por gama: un «Combo Pro» se arma con las piezas «Pro». Solo se
     aplica si deja exactamente una en pie; si no, se prefiere no adivinar. */
  if (/\bpro\b/.test(norm(nombreCombo))) {
    const pro = hits.filter((p) => /\bpro\b/.test(norm(p.nombre)));
    if (pro.length === 1) return pro;
  }
  return hits;
}

/* --- Plan ---------------------------------------------------------------- */

const bundles = productos
  .filter((p) => (p.sku ?? "").toUpperCase().startsWith(PREFIJO_BUNDLE))
  .sort((a, b) => a.sku.localeCompare(b.sku));

if (!bundles.length) {
  console.error(`No hay ninguna ficha con SKU que empiece con ${PREFIJO_BUNDLE}.`);
  process.exit(1);
}

const { data: yaExisten } = await admin.from("conjuntos").select("sku");
const vistos = new Set((yaExisten ?? []).map((c) => String(c.sku).toUpperCase()));

const plan = [];
const resumen = { ligados: 0, ambiguos: 0, sinMatch: 0, omitidos: 0 };
const dudosos = [];

for (const b of bundles) {
  const sku = b.sku.trim().toUpperCase();
  if (vistos.has(sku)) {
    resumen.omitidos++;
    continue;
  }
  vistos.add(sku);

  const diseno = palabrasDeDiseno(b.nombre);
  const componentes = [];

  for (const rol of ["munequeras", "straps"]) {
    const hits = candidatos(diseno, rol, b.nombre);

    if (hits.length === 1) resumen.ligados++;
    else if (hits.length > 1) {
      resumen.ambiguos++;
      dudosos.push(`${sku} · ${rol}: ${hits.map((h) => h.sku).join(", ")}`);
    } else {
      resumen.sinMatch++;
      dudosos.push(`${sku} · ${rol}: ninguna ficha coincide con «${diseno.join(" ")}»`);
    }

    componentes.push({
      rol,
      producto_id: hits.length === 1 ? hits[0].id : null,
      /* Con la ficha resuelta va su SKU real; si no, el nombre del diseño con el
         rol delante, para que las dos piezas no choquen contra el
         unique (conjunto_id, sku_componente). */
      sku_componente:
        hits.length === 1 ? hits[0].sku : `${rol.toUpperCase()}·${diseno.join(" ") || b.nombre}`,
      cantidad: 1,
      candidatos: hits.length,
    });
  }

  plan.push({
    sku,
    titulo: b.nombre,
    /* Todo esto es la misma familia; la categoría fina vive en la ficha. */
    categoria: "Combos",
    producto_id: b.id,
    stock_ficha: b.stock,
    componentes,
  });
}

console.log(`Bundles en el catálogo (${PREFIJO_BUNDLE}…): ${bundles.length}`);
console.log(`Ya eran conjuntos, se omiten:            ${resumen.omitidos}`);
console.log(`Nuevos para el CRM:                      ${plan.length}`);
console.log(`\nComponentes:`);
console.log(`  ligados a una ficha:  ${resumen.ligados}`);
console.log(`  con varios candidatos:${String(resumen.ambiguos).padStart(4)}  (quedan sin ligar)`);
console.log(`  sin ninguno:          ${resumen.sinMatch}  (quedan sin ligar)`);

console.log("\nPlan:");
for (const c of plan) {
  console.log(`  ${c.sku.padEnd(10)} stock ${String(c.stock_ficha).padStart(4)}  ${c.titulo.slice(0, 50)}`);
  for (const comp of c.componentes) {
    const marca = comp.producto_id ? "ligado" : comp.candidatos > 1 ? "ambiguo" : "sin ficha";
    console.log(`       ${comp.rol.padEnd(11)} ${marca.padEnd(10)} ${comp.sku_componente}`);
  }
}

if (dudosos.length) {
  console.log("\nPor revisar a mano (quedan sin ligar; se resuelven desde «Ligar componentes»):");
  for (const d of dudosos) console.log(`  ${d}`);
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
    plan.map((c) => ({
      sku: c.sku,
      titulo: c.titulo,
      categoria: c.categoria,
      talla: null,
      producto_id: c.producto_id,
    })),
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
console.log("El stock no se tocó: los combos siguen en 0 hasta que bodega registre un armado.");
