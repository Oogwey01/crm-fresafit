/* ============================================================================
   scripts/importar-personalizados-xlsx.mjs
   ----------------------------------------------------------------------------
   Carga la hoja «Personalizados FRESA FIT» al CRM desde el .xlsx descargado:
   los pedidos, sus fechas, sus links y las imágenes del diseño.

   POR QUÉ NO SE PEGA Y YA:
   Pegar la hoja en el importador de la pantalla pierde tres cosas, y las tres
   importan:

     1. Las FECHAS. En la pantalla se leen «19 jul», sin año, y hay que
        adivinarlo. En el .xlsx son números de serie de Excel: 45857 es
        2025-07-19, sin lugar a dudas. La hoja va de julio 2025 a marzo 2026, no
        de 2026 como parecía.
     2. Las CELDAS CON SALTO DE LÍNEA. Varios números de venta traen un retorno
        dentro; al copiar, Sheets los entrecomilla y el renglón se parte en dos.
        Así fue como once fichas acabaron sin número de venta y una se llamó `"`.
     3. Las IMÁGENES y los LINKS. Un .xlsx es un zip: las imágenes están enteras
        en `xl/media/` con un XML que dice a qué fila pertenece cada una, y los
        hipervínculos están en las relaciones de la hoja.

   Cómo se consigue el .xlsx:
     En el Sheet → Archivo → Descargar → Microsoft Excel (.xlsx)

   Uso (Node 20+):
     # 1. Ver el plan completo sin tocar nada. SIEMPRE correr esto primero.
     node --env-file=.env.local scripts/importar-personalizados-xlsx.mjs \
       --archivo ~/Downloads/AirDrop_BOX/"Personalizados FRESA FIT.xlsx"

     # 2. Ejecutarlo.
     node --env-file=.env.local scripts/importar-personalizados-xlsx.mjs \
       --archivo … --ejecutar

     # 3. Si ya había una carga previa hecha a mano o pegada, esto la retira
     #    antes de recargar (BORRA fichas: leer el plan antes).
     node --env-file=.env.local scripts/importar-personalizados-xlsx.mjs \
       --archivo … --ejecutar --reemplazar

   Idempotente: cada ficha lleva `clave = hoja-<nº de fila>`, así que volver a
   correrlo actualiza en vez de duplicar. Las filas repetidas de la hoja (un
   pedido con dos cinturones, como el #4728) quedan como dos fichas, que es lo
   correcto.

   Requiere en el entorno:
     NEXT_PUBLIC_SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY   (service role — NUNCA en el cliente ni en git)
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* --flag valor → { flag: "valor" }. Los booleanos (--ejecutar) quedan en true. */
function leerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const clave = argv[i].slice(2);
    const siguiente = argv[i + 1];
    if (siguiente && !siguiente.startsWith("--")) {
      args[clave] = siguiente;
      i++;
    } else {
      args[clave] = true;
    }
  }
  return args;
}

const args = leerArgs(process.argv.slice(2));
const EJECUTAR = args.ejecutar === true;
const REEMPLAZAR = args.reemplazar === true;

if (!args.archivo || args.archivo === true) {
  console.error("Falta --archivo con la ruta al .xlsx descargado del Sheet.");
  process.exit(1);
}
if (!existsSync(args.archivo)) {
  console.error(`No existe el archivo: ${args.archivo}`);
  process.exit(1);
}

/* ==========================================================================
   1. Leer el .xlsx
   --------------------------------------------------------------------------
   Se parsea con expresiones regulares en vez de con una librería de XML: son
   cinco archivos con una forma muy acotada, y así el proyecto no carga una
   dependencia por algo que se hace una vez. Todo lo que no se entienda se
   reporta en pantalla; nada se salta en silencio.
   ========================================================================== */

const dir = mkdtempSync(join(tmpdir(), "personalizados-"));
const limpiar = () => rmSync(dir, { recursive: true, force: true });

try {
  execFileSync("unzip", ["-qo", args.archivo, "-d", dir]);
} catch (e) {
  console.error("No se pudo descomprimir el .xlsx:", e.message);
  limpiar();
  process.exit(1);
}

const leer = (ruta) => (existsSync(join(dir, ruta)) ? readFileSync(join(dir, ruta), "utf8") : null);

const desescapar = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/* Textos compartidos: las celdas con t="s" guardan un índice a esta tabla. */
const cadenas = [];
for (const si of (leer("xl/sharedStrings.xml") ?? "").match(/<si>[\s\S]*?<\/si>/g) ?? []) {
  cadenas.push(desescapar([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
}

const hojas = readdirSync(join(dir, "xl/worksheets")).filter((f) => f.endsWith(".xml")).sort();
if (!hojas.length) {
  console.error("El .xlsx no trae hojas.");
  limpiar();
  process.exit(1);
}
const nombreHoja = hojas[0];
const xmlHoja = leer(`xl/worksheets/${nombreHoja}`);

/* fila (1-based) → { A: "…", B: "…" }.
   El regex contempla las celdas AUTO-CERRADAS (`<c r="C2" s="10"/>`), que es
   como viaja una celda vacía con formato. Sin eso, la primera celda vacía se
   come el valor de la siguiente y todas las columnas se recorren. */
const filas = new Map();
for (const fila of xmlHoja.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
  const numero = Number(/<row[^>]*\sr="(\d+)"/.exec(fila)?.[1]);
  if (!numero) continue;
  const celdas = {};
  for (const m of fila.matchAll(/<c\s+r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, columna, atributos, cuerpo] = m;
    if (cuerpo === undefined) {
      celdas[columna] = "";
      continue;
    }
    const valor = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
    if (valor === undefined) {
      celdas[columna] = "";
      continue;
    }
    celdas[columna] = / t="s"/.test(atributos) ? (cadenas[Number(valor)] ?? "") : desescapar(valor);
  }
  filas.set(numero, celdas);
}

/* Hipervínculos de la columna LINK: la celda dice «Link» y la URL vive en las
   relaciones de la hoja. */
const relsHoja = leer(`xl/worksheets/_rels/${nombreHoja}.rels`) ?? "";
const destinoRel = new Map();
for (const m of relsHoja.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
  destinoRel.set(m[1], desescapar(m[2]));
}
/* celda ("I2") → url */
const urlDeCelda = new Map();
for (const m of xmlHoja.matchAll(/<hyperlink[^>]*r:id="([^"]+)"[^>]*ref="([^"]+)"[^>]*\/>/g)) {
  const url = destinoRel.get(m[1]);
  if (url) urlDeCelda.set(m[2], url);
}
for (const m of xmlHoja.matchAll(/<hyperlink[^>]*ref="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
  const url = destinoRel.get(m[2]);
  if (url) urlDeCelda.set(m[1], url);
}

/* Imágenes: cada ancla del dibujo dice en qué fila (0-based) está. */
const dibujos = existsSync(join(dir, "xl/drawings"))
  ? readdirSync(join(dir, "xl/drawings")).filter((f) => f.endsWith(".xml"))
  : [];
const imagenPorFila = new Map();
for (const dib of dibujos) {
  const xml = leer(`xl/drawings/${dib}`);
  const rels = leer(`xl/drawings/_rels/${dib}.rels`) ?? "";
  const destino = new Map();
  for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    destino.set(m[1], m[2].replace(/^\.\.\//, "xl/"));
  }
  const anclas =
    xml.match(/<(?:\w+:)?(?:two|one)CellAnchor[\s\S]*?<\/(?:\w+:)?(?:two|one)CellAnchor>/g) ?? [];
  for (const ancla of anclas) {
    const fila0 = /<(?:\w+:)?from>[\s\S]*?<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/.exec(ancla)?.[1];
    const rId = /r:embed="([^"]+)"/.exec(ancla)?.[1];
    if (fila0 === undefined || !rId) continue;
    const ruta = destino.get(rId);
    if (!ruta || !existsSync(join(dir, ruta))) continue;
    const fila = Number(fila0) + 1; // el XML cuenta desde 0
    /* Una fila es un cinturón: si hubiera dos anclas, se queda la primera. */
    if (!imagenPorFila.has(fila)) imagenPorFila.set(fila, ruta);
  }
}

/* ==========================================================================
   2. Convertir las filas en fichas
   ========================================================================== */

/* Los números de serie de Excel cuentan días desde el 30/12/1899. */
function fechaDeSerial(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

const limpio = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const normalizar = (s) => limpio(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

/* «TIPO DE CINTO» de la hoja → el catálogo del CRM. */
function modeloDe(celda) {
  const t = normalizar(celda);
  if (!t) return null;
  if (t.includes("POWERLIFT")) return "powerlift";
  if (t.includes("HEBILLA")) return "hebilla";
  if (t.includes("SEVILLA")) return "sevilla";
  return "otro";
}

/* Los pedidos de 16 dígitos que empiezan en 2000 son de Mercado Libre. El
   resto trae link de Shopify (la tienda vieja), así que no se les asigna canal:
   inventarlo sería peor que dejarlo en blanco. */
function canalDe(noVenta) {
  return /^#?\s*2000\d{12,}/.test(limpio(noVenta)) ? "mercado_libre" : null;
}

/* Las columnas de la hoja, confirmadas contra el encabezado por si se mueven. */
const COL = { venta: "A", nombre: "B", tipo: "D", talla: "E", compra: "F", produccion: "G", limite: "H", link: "I", notas: "J" };
const encabezado = filas.get(1) ?? {};
for (const [col, valor] of Object.entries(encabezado)) {
  const t = normalizar(valor);
  if (t.includes("NUMERO DE VENTA")) COL.venta = col;
  else if (t === "NOMBRE") COL.nombre = col;
  else if (t.includes("TIPO DE CINTO")) COL.tipo = col;
  else if (t === "TALLA") COL.talla = col;
  else if (t === "COMPRA") COL.compra = col;
  else if (t.includes("PRODUCCION")) COL.produccion = col;
  else if (t.includes("FECHA LIMITE")) COL.limite = col;
  else if (t === "LINK") COL.link = col;
  else if (t === "NOTAS") COL.notas = col;
}

const fichas = [];
for (const [n, celdas] of [...filas].sort((a, b) => a[0] - b[0])) {
  if (n === 1) continue;
  const cliente = limpio(celdas[COL.nombre]);
  if (!cliente) continue;

  const produccion = fechaDeSerial(celdas[COL.produccion]);
  fichas.push({
    clave: `hoja-${n}`,
    fila: n,
    no_venta: limpio(celdas[COL.venta]) || null,
    cliente,
    modelo: modeloDe(celdas[COL.tipo]),
    talla: limpio(celdas[COL.talla]) || null,
    canal: canalDe(celdas[COL.venta]),
    fecha_compra: fechaDeSerial(celdas[COL.compra]),
    fecha_produccion: produccion,
    fecha_limite: fechaDeSerial(celdas[COL.limite]),
    url: urlDeCelda.get(`${COL.link}${n}`) ?? null,
    /* El estado real es el COLOR de la celda en la hoja, y el color no es un
       dato: aquí se deduce de si ya se mandó a producción. Hay que repasarlo. */
    estado: produccion ? "produccion" : "recibido",
    notas: limpio(celdas[COL.notas]) || null,
    media: imagenPorFila.get(n) ?? null,
  });
}

/* ==========================================================================
   3. Reporte
   ========================================================================== */

const fechas = fichas.map((f) => f.fecha_produccion ?? f.fecha_limite).filter(Boolean).sort();
const repetidos = new Map();
for (const f of fichas) {
  if (!f.no_venta) continue;
  const k = normalizar(f.no_venta);
  repetidos.set(k, (repetidos.get(k) ?? 0) + 1);
}

console.log(`Hoja: ${nombreHoja}`);
console.log(`Pedidos en la hoja:     ${fichas.length}`);
console.log(`Con imagen de diseño:   ${fichas.filter((f) => f.media).length}`);
console.log(`Con link:               ${fichas.filter((f) => f.url).length}`);
console.log(`Sin número de venta:    ${fichas.filter((f) => !f.no_venta).length}`);
console.log(`Rango de fechas:        ${fechas[0] ?? "—"} … ${fechas.at(-1) ?? "—"}`);
const dobles = [...repetidos].filter(([, n]) => n > 1);
if (dobles.length) {
  console.log(`Pedidos con más de un cinturón: ${dobles.map(([v, n]) => `${v}×${n}`).join(", ")}`);
}
console.log("\nPrimeros 5:");
for (const f of fichas.slice(0, 5)) {
  console.log(
    `  fila ${String(f.fila).padStart(3)}  ${(f.no_venta ?? "—").padEnd(20)} ${f.cliente.padEnd(34)}` +
      ` ${(f.modelo ?? "—").padEnd(10)} ${(f.talla ?? "—").padEnd(6)} prod=${f.fecha_produccion ?? "—"} lim=${f.fecha_limite ?? "—"}` +
      ` ${f.media ? "img" : "   "} ${f.url ? "link" : ""}`,
  );
}
console.log("Últimos 5:");
for (const f of fichas.slice(-5)) {
  console.log(
    `  fila ${String(f.fila).padStart(3)}  ${(f.no_venta ?? "—").padEnd(20)} ${f.cliente.padEnd(34)}` +
      ` ${(f.modelo ?? "—").padEnd(10)} ${(f.talla ?? "—").padEnd(6)} prod=${f.fecha_produccion ?? "—"} lim=${f.fecha_limite ?? "—"}` +
      ` ${f.media ? "img" : "   "} ${f.url ? "link" : ""}`,
  );
}

/* ==========================================================================
   4. Contra el CRM
   ========================================================================== */

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: existentes, error: errLeer } = await admin
  .from("personalizados")
  .select("id, clave, cliente, foto_path");
if (errLeer) {
  console.error("\nNo se pudieron leer los personalizados:", errLeer.message);
  limpiar();
  process.exit(1);
}

const deEsteScript = existentes.filter((p) => (p.clave ?? "").startsWith("hoja-"));
const ajenas = existentes.filter((p) => !(p.clave ?? "").startsWith("hoja-"));

console.log(`\n=== CRM ===`);
console.log(`Fichas actuales:                    ${existentes.length}`);
console.log(`  de una carga previa de este script: ${deEsteScript.length}`);
console.log(`  de otro origen (pegado o migración): ${ajenas.length}`);

if (ajenas.length && !REEMPLAZAR) {
  console.log(
    `\n  Esas ${ajenas.length} fichas vienen del pegado en pantalla: traen las fechas\n` +
      "  con el año adivinado y a varias les falta el número de venta. Volver a\n" +
      "  cargar sin retirarlas dejaría todo duplicado.\n" +
      "  Añade --reemplazar para borrarlas y quedarte solo con lo del .xlsx.",
  );
}

if (!EJECUTAR) {
  console.log("\n(Prueba en seco: no se tocó nada. Repite con --ejecutar cuando el plan se vea bien.)");
  limpiar();
  process.exit(0);
}

/* ==========================================================================
   5. Ejecutar
   ========================================================================== */

if (REEMPLAZAR && ajenas.length) {
  /* Se borran también sus imágenes del bucket, si tuvieran. */
  const conFoto = ajenas.filter((p) => p.foto_path).map((p) => p.foto_path);
  if (conFoto.length) await admin.storage.from("personalizados").remove(conFoto);
  const { error } = await admin
    .from("personalizados")
    .delete()
    .in("id", ajenas.map((p) => p.id));
  if (error) {
    console.error("No se pudieron borrar las fichas previas:", error.message);
    limpiar();
    process.exit(1);
  }
  console.log(`\nRetiradas ${ajenas.length} fichas de la carga anterior.`);
}

/* Alta o actualización por `clave`. */
const { error: errUpsert } = await admin.from("personalizados").upsert(
  fichas.map((f) => ({
    clave: f.clave,
    no_venta: f.no_venta,
    cliente: f.cliente,
    modelo: f.modelo,
    talla: f.talla,
    canal: f.canal,
    fecha_compra: f.fecha_compra,
    fecha_produccion: f.fecha_produccion,
    fecha_limite: f.fecha_limite,
    url: f.url,
    estado: f.estado,
    notas: f.notas,
  })),
  { onConflict: "clave" },
);
if (errUpsert) {
  console.error("No se pudieron guardar las fichas:", errUpsert.message);
  limpiar();
  process.exit(1);
}
console.log(`Guardadas ${fichas.length} fichas.`);

/* Las imágenes, ya con los ids en mano. */
const { data: guardadas } = await admin
  .from("personalizados")
  .select("id, clave")
  .like("clave", "hoja-%");
const idPorClave = new Map((guardadas ?? []).map((p) => [p.clave, p.id]));

const TIPOS = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
let subidas = 0;
let fallos = 0;
for (const f of fichas) {
  if (!f.media) continue;
  const id = idPorClave.get(f.clave);
  if (!id) continue;

  const ext = (f.media.split(".").pop() ?? "png").toLowerCase();
  /* Ruta derivada del id: volver a correr el script reemplaza el binario en vez
     de dejar copias huérfanas en el bucket. */
  const ruta = `${id}/diseno-hoja.${ext}`;

  const { error: errSubida } = await admin.storage
    .from("personalizados")
    .upload(ruta, readFileSync(join(dir, f.media)), {
      contentType: TIPOS[ext] ?? "application/octet-stream",
      upsert: true,
    });
  if (errSubida) {
    console.error(`  FALLA imagen fila ${f.fila} (${f.cliente}): ${errSubida.message}`);
    fallos++;
    continue;
  }

  const { error: errFicha } = await admin
    .from("personalizados")
    .update({ foto_path: ruta })
    .eq("id", id);
  if (errFicha) {
    await admin.storage.from("personalizados").remove([ruta]);
    console.error(`  FALLA ficha fila ${f.fila} (${f.cliente}): ${errFicha.message}`);
    fallos++;
    continue;
  }
  subidas++;
}

console.log(`Subidos ${subidas} diseños${fallos ? `, ${fallos} con error` : ""}.`);
limpiar();
