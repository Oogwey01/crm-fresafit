/* ============================================================================
   scripts/importar-cintos-2026-xlsx.mjs
   ----------------------------------------------------------------------------
   Carga la hoja «Cinturones personalizados FRESA FIT» (la nueva, con una
   pestaña por mes de 2026) a la tabla `personalizados`.

   NO ES EL MISMO ARCHIVO que leyó importar-personalizados-xlsx.mjs, y por eso
   este script existe aparte:

     1. Son ONCE pestañas (FEBRERO…DICIEMBRE), no una. El script viejo toma la
        primera hoja y las demás se perderían en silencio.
     2. Hay una columna nueva: BORDADO O SUBLIMADO (col D) — es el `tipo` de la
        ficha, que la carga vieja dejó en NULL y el formulario deja siempre en
        'sublimado' por default.
     3. La mitad de las filas YA EXISTEN en el CRM: 13 de la carga vieja
        (clave hoja-N) y ~76 fichas vivas creadas desde las ventas. Aquí no se
        reemplaza nada: se RECONCILIA por número de venta.

   Política acordada (13/08/2026):
     - Ficha existente → rellenar solo huecos. Única excepción: `tipo` se
       escribe siempre que la pestaña traiga la técnica, porque el dato actual
       es un default, no un dato. `estado`, `canal`, `sale_order_id` y
       `responsable_id` no se tocan jamás.
     - Fila sin ficha → alta con clave `cintos26-<PESTAÑA>-<fila>` y estado
       'enviado' (es historia ya entregada).
     - La foto del diseño solo se sube si la ficha no tiene.
     - Sin bandera --reemplazar a propósito: borrar lo que no venga del Excel
       arrasaría las fichas vivas ligadas a pedidos de maquila.

   Uso (Node 20+):
     # 1. Ver el plan completo sin tocar nada. SIEMPRE correr esto primero.
     node --env-file=.env.local scripts/importar-cintos-2026-xlsx.mjs \
       --archivo "Cinturones personalizados FRESA FIT.xlsx"

     # 2. Ejecutarlo (escribe en la base de PRODUCCIÓN).
     node --env-file=.env.local scripts/importar-cintos-2026-xlsx.mjs \
       --archivo … --ejecutar

   Idempotente: volver a correrlo encuentra las fichas por folio o por clave y
   reporta cero cambios.

   Requiere en el entorno:
     NEXT_PUBLIC_SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY   (service role — NUNCA en el cliente ni en git)
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* Mismo tamaño que usan los importadores de ventas (lib/supabase/lotes.ts).
   Copiado, no importado: un .mjs no puede cargar la lib TS. */
const TAM_LOTE_UPSERT = 200;

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

if (!args.archivo || args.archivo === true) {
  console.error("Falta --archivo con la ruta al .xlsx.");
  process.exit(1);
}
if (!existsSync(args.archivo)) {
  console.error(`No existe el archivo: ${args.archivo}`);
  process.exit(1);
}

/* ==========================================================================
   1. Leer el .xlsx (unzip + regex, como el importador hermano)
   ========================================================================== */

const dir = mkdtempSync(join(tmpdir(), "cintos26-"));
const limpiarTmp = () => rmSync(dir, { recursive: true, force: true });

try {
  execFileSync("unzip", ["-qo", args.archivo, "-d", dir]);
} catch (e) {
  console.error("No se pudo descomprimir el .xlsx:", e.message);
  limpiarTmp();
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

const cadenas = [];
for (const si of (leer("xl/sharedStrings.xml") ?? "").match(/<si>[\s\S]*?<\/si>/g) ?? []) {
  cadenas.push(desescapar([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
}

/* Las pestañas EN ORDEN y con su nombre, resueltas desde el workbook y sus
   relaciones. Nada de readdirSync: el orden alfabético de los archivos
   (sheet1, sheet10, sheet11, sheet2…) no es el orden del libro. */
const relsWb = leer("xl/_rels/workbook.xml.rels") ?? "";
const destinoWb = new Map();
for (const m of relsWb.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
  destinoWb.set(m[1], m[2].replace(/^\/?(xl\/)?/, ""));
}
const pestanas = [];
for (const m of (leer("xl/workbook.xml") ?? "").matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const archivo = destinoWb.get(m[2]);
  if (archivo) pestanas.push({ nombre: m[1], archivo });
}
if (!pestanas.length) {
  console.error("El .xlsx no trae pestañas.");
  limpiarTmp();
  process.exit(1);
}

/* Los números de serie de Excel cuentan días desde el 30/12/1899. */
function fechaDeSerial(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

const limpio = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const normalizar = (s) => limpio(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

/* Folio comparable: sin #, sin espacios ni saltos, sin el ".0" de los
   flotantes de Excel y sin ceros a la izquierda. */
function folioNorm(s) {
  let t = String(s ?? "").replace(/[#\s]/g, "").replace(/\.0$/, "");
  if (/^\d+$/.test(t)) t = String(Number(t));
  t = t.toUpperCase();
  return t === "NA" ? "" : t;
}

/* «TIPO DE CINTO» de la hoja → el catálogo del CRM (MODELOS_PERSONALIZADO). */
function modeloDe(celda) {
  const t = normalizar(celda);
  if (!t) return null;
  if (t.includes("POWERLIFT")) return "powerlift";
  if (t.includes("HEBILLA")) return "hebilla";
  if (t.includes("SEVILLA")) return "sevilla";
  return "otro";
}

/* «BORDADO O SUBLIMADO» → el `tipo` de la ficha (TIPOS_PERSONALIZADO). */
function tipoDe(celda) {
  const t = normalizar(celda);
  if (!t) return null;
  if (t.includes("BORDADO")) return "bordado";
  if (t.includes("SUBLIMADO")) return "sublimado";
  return "otro";
}

/* Los pedidos de 16 dígitos que empiezan en 2000 son de Mercado Libre. Al
   resto no se le asigna canal: la hoja mezcla folios de la tienda vieja y de
   la nueva, y adivinar sería peor que dejarlo en blanco. */
function canalDe(folio) {
  return /^2000\d{12,}$/.test(folio) ? "mercado_libre" : null;
}

const filasExcel = [];
for (const p of pestanas) {
  const xml = leer(`xl/${p.archivo}`);
  if (!xml) continue;

  const filas = new Map();
  for (const fila of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
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

  /* Hipervínculos de la columna LINK: la URL vive en las relaciones. */
  const nombreArchivo = p.archivo.split("/").pop();
  const relsHoja = leer(`xl/worksheets/_rels/${nombreArchivo}.rels`) ?? "";
  const destinoRel = new Map();
  for (const m of relsHoja.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    destinoRel.set(m[1], desescapar(m[2]));
  }
  const urlDeCelda = new Map();
  for (const m of xml.matchAll(/<hyperlink[^>]*r:id="([^"]+)"[^>]*ref="([^"]+)"[^>]*\/>/g)) {
    const url = destinoRel.get(m[1]);
    if (url) urlDeCelda.set(m[2], url);
  }
  for (const m of xml.matchAll(/<hyperlink[^>]*ref="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
    const url = destinoRel.get(m[2]);
    if (url) urlDeCelda.set(m[1], url);
  }

  /* Imágenes DE ESTA PESTAÑA: su drawing sale de sus relaciones, no de un
     barrido global — con once hojas, un barrido cruzaría filas de meses
     distintos. */
  const imagenPorFila = new Map();
  const ridDibujo = /<drawing[^>]*r:id="([^"]+)"/.exec(xml)?.[1];
  const rutaDibujo = ridDibujo ? destinoRel.get(ridDibujo)?.replace(/^\.\.\//, "xl/") : null;
  if (rutaDibujo) {
    const xmlDibujo = leer(rutaDibujo) ?? "";
    const relsDibujo = leer(rutaDibujo.replace(/([^/]+)$/, "_rels/$1.rels")) ?? "";
    const destinoDibujo = new Map();
    for (const m of relsDibujo.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      destinoDibujo.set(m[1], m[2].replace(/^\.\.\//, "xl/"));
    }
    const anclas =
      xmlDibujo.match(/<(?:\w+:)?(?:two|one)CellAnchor[\s\S]*?<\/(?:\w+:)?(?:two|one)CellAnchor>/g) ?? [];
    for (const ancla of anclas) {
      const fila0 = /<(?:\w+:)?from>[\s\S]*?<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/.exec(ancla)?.[1];
      const rId = /r:embed="([^"]+)"/.exec(ancla)?.[1];
      if (fila0 === undefined || !rId) continue;
      const ruta = destinoDibujo.get(rId);
      if (!ruta || !existsSync(join(dir, ruta))) continue;
      const fila = Number(fila0) + 1; // el XML cuenta desde 0
      if (!imagenPorFila.has(fila)) imagenPorFila.set(fila, ruta);
    }
  }

  /* Columnas con default y confirmación contra el encabezado, que cambia de
     pestaña en pestaña («NUMERO DE VENTA», «B», «ORDEN»…). */
  const COL = { venta: "A", nombre: "B", tecnica: "D", modelo: "E", talla: "F", compra: "G", produccion: "H", limite: "I", link: "J", notas: "K" };
  for (const [col, valor] of Object.entries(filas.get(1) ?? {})) {
    const t = normalizar(valor);
    if (t.includes("NUMERO DE VENTA") || t === "ORDEN") COL.venta = col;
    else if (t === "NOMBRE") COL.nombre = col;
    else if (t.includes("BORDADO")) COL.tecnica = col;
    else if (t.includes("TIPO DE CINTO")) COL.modelo = col;
    else if (t === "TALLA") COL.talla = col;
    else if (t === "COMPRA") COL.compra = col;
    else if (t.includes("PRODUCCION")) COL.produccion = col;
    else if (t.includes("FECHA LIMITE")) COL.limite = col;
    else if (t === "LINK") COL.link = col;
    else if (t.includes("NOTAS")) COL.notas = col;
  }

  for (const [n, celdas] of [...filas].sort((a, b) => a[0] - b[0])) {
    if (n === 1) continue;
    const cliente = limpio(celdas[COL.nombre]);
    if (!cliente) continue;
    const folio = folioNorm(celdas[COL.venta]);
    filasExcel.push({
      pestana: p.nombre,
      fila: n,
      clave: `cintos26-${p.nombre}-${n}`,
      folio,
      no_venta: limpio(celdas[COL.venta]) || null,
      cliente,
      tipo: tipoDe(celdas[COL.tecnica]),
      modelo: modeloDe(celdas[COL.modelo]),
      talla: limpio(celdas[COL.talla]) || null,
      canal: canalDe(folio),
      fecha_compra: fechaDeSerial(celdas[COL.compra]),
      fecha_produccion: fechaDeSerial(celdas[COL.produccion]),
      fecha_limite: fechaDeSerial(celdas[COL.limite]),
      url: urlDeCelda.get(`${COL.link}${n}`) ?? null,
      notas: limpio(celdas[COL.notas]) || null,
      media: imagenPorFila.get(n) ?? null,
    });
  }
}

/* ==========================================================================
   2. Las fichas que ya viven en el CRM
   ========================================================================== */

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

/* Lectura COMPLETA por páginas: PostgREST corta en ~1000 filas sin avisar
   (ARQUITECTURA.md), y aquí una lectura recortada se convierte en duplicados. */
async function traerTodas(columnas) {
  const todas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await admin
      .from("personalizados")
      .select(columnas)
      .order("id")
      .range(desde, desde + 999);
    if (error) {
      console.error("No se pudieron leer los personalizados:", error.message);
      limpiarTmp();
      process.exit(1);
    }
    todas.push(...data);
    if (data.length < 1000) return todas;
  }
}

const fichas = await traerTodas(
  "id, clave, no_venta, cliente, tipo, modelo, talla, fecha_compra, fecha_produccion, fecha_limite, url, foto_path, estado, notas, created_at",
);

/* folio → fichas que lo llevan, en orden estable de llegada al CRM. Así la
   n-ésima fila de un pedido de dos cinturones cae en la n-ésima ficha. */
const fichasPorFolio = new Map();
for (const f of fichas) {
  const k = folioNorm(f.no_venta);
  if (!k) continue;
  if (!fichasPorFolio.has(k)) fichasPorFolio.set(k, []);
  fichasPorFolio.get(k).push(f);
}
for (const lista of fichasPorFolio.values()) {
  lista.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
}
const fichaPorClave = new Map(fichas.filter((f) => f.clave).map((f) => [f.clave, f]));

/* ==========================================================================
   3. Reconciliar: cada fila del Excel acaba en alta, relleno o reporte
   ========================================================================== */

/* Dos nombres "se parecen" si comparten al menos una palabra de 3+ letras.
   Protege de que un folio reciclado entre tiendas rellene la ficha de otra
   persona; los acentos y el orden de apellidos no estorban. */
function nombresParecidos(a, b) {
  const tokens = (s) => new Set(normalizar(s).split(/[^A-ZÑ]+/).filter((t) => t.length >= 3));
  const ta = tokens(a);
  for (const t of tokens(b)) if (ta.has(t)) return true;
  return ta.size === 0;
}

/* Campos que solo se rellenan si la ficha los tiene vacíos. */
const RELLENABLES = ["modelo", "talla", "fecha_compra", "fecha_produccion", "fecha_limite", "url", "notas"];

const altas = [];        // { fila, insercion }
const rellenos = [];     // { fila, ficha, patch }
const fotosPend = [];    // { fila, fichaId } — fichaId null hasta después del alta
const sinCambio = [];
const dudosas = [];      // folio casó pero el nombre no se parece
const desbordadas = [];  // más filas en el Excel que fichas con ese folio

const vistasPorFolio = new Map(); // cuántas filas del Excel ya reclamaron cada folio

for (const fila of filasExcel) {
  /* Una corrida previa de este script ya la insertó → se reconcilia por clave. */
  const candidatas = fichaPorClave.has(fila.clave)
    ? [fichaPorClave.get(fila.clave)]
    : (fila.folio && fichasPorFolio.get(fila.folio)) || [];

  let ficha = null;
  if (candidatas.length) {
    const vistas = vistasPorFolio.get(fila.folio) ?? 0;
    if (!fichaPorClave.has(fila.clave)) vistasPorFolio.set(fila.folio, vistas + 1);
    ficha = candidatas[fichaPorClave.has(fila.clave) ? 0 : vistas] ?? null;
    if (!ficha) {
      /* Pedido con más cinturones en el Excel que fichas en el CRM: dar de
         alta uno nuevo inventaría un cinturón fantasma sobre una venta viva.
         Se reporta para revisarlo a mano. */
      desbordadas.push(fila);
      continue;
    }
    /* Las fichas auto-sembradas desde la venta nacen «Sin nombre»: ahí el
       Excel no contradice nada, completa. */
    const fichaSinNombre = !limpio(ficha.cliente) || limpio(ficha.cliente) === "Sin nombre";
    if (!fichaSinNombre && !nombresParecidos(fila.cliente, ficha.cliente ?? "")) {
      dudosas.push({ fila, ficha });
      continue;
    }
  }

  if (!ficha) {
    altas.push({
      fila,
      insercion: {
        clave: fila.clave,
        no_venta: fila.no_venta,
        cliente: fila.cliente,
        tipo: fila.tipo,
        modelo: fila.modelo,
        talla: fila.talla,
        canal: fila.canal,
        fecha_compra: fila.fecha_compra,
        fecha_produccion: fila.fecha_produccion,
        fecha_limite: fila.fecha_limite,
        url: fila.url,
        estado: "enviado",
        notas: fila.notas,
      },
    });
    if (fila.media) fotosPend.push({ fila, fichaId: null });
    continue;
  }

  const patch = {};
  /* La técnica manda siempre: lo que hay en la BD es un default, no un dato. */
  if (fila.tipo && fila.tipo !== ficha.tipo) patch.tipo = fila.tipo;
  if ((!limpio(ficha.cliente) || limpio(ficha.cliente) === "Sin nombre") && fila.cliente) {
    patch.cliente = fila.cliente;
  }
  for (const campo of RELLENABLES) {
    if (fila[campo] != null && fila[campo] !== "" && (ficha[campo] == null || ficha[campo] === "")) {
      patch[campo] = fila[campo];
    }
  }
  const subeFoto = fila.media && !ficha.foto_path;
  if (subeFoto) fotosPend.push({ fila, fichaId: ficha.id });

  if (Object.keys(patch).length) rellenos.push({ fila, ficha, patch });
  else if (!subeFoto) sinCambio.push(fila);
}

/* ==========================================================================
   4. Reporte
   ========================================================================== */

const porPestana = new Map();
const suma = (p, campo) => {
  if (!porPestana.has(p)) porPestana.set(p, { filas: 0, altas: 0, rellenos: 0, fotos: 0 });
  porPestana.get(p)[campo]++;
};
for (const f of filasExcel) suma(f.pestana, "filas");
for (const a of altas) suma(a.fila.pestana, "altas");
for (const r of rellenos) suma(r.fila.pestana, "rellenos");
for (const f of fotosPend) suma(f.fila.pestana, "fotos");

console.log(`Filas con datos en el Excel: ${filasExcel.length}\n`);
console.log("Pestaña       filas  altas  rellenos  fotos");
for (const [p, c] of porPestana) {
  console.log(
    `  ${p.padEnd(12)} ${String(c.filas).padStart(4)} ${String(c.altas).padStart(6)} ${String(c.rellenos).padStart(9)} ${String(c.fotos).padStart(6)}`,
  );
}
console.log(`\nAltas nuevas (nacen 'enviado'):      ${altas.length}`);
console.log(`Fichas a rellenar:                   ${rellenos.length}`);
console.log(`Fotos de diseño a subir:             ${fotosPend.length}`);
console.log(`Sin nada que cambiar:                ${sinCambio.length}`);
console.log(`Dudosas (folio sí, nombre no):       ${dudosas.length}`);
console.log(`Desbordadas (más filas que fichas):  ${desbordadas.length}`);

if (dudosas.length) {
  console.log("\nDUDOSAS — no se tocan; revisar a mano:");
  for (const { fila, ficha } of dudosas) {
    console.log(`  ${fila.pestana} fila ${fila.fila}: «${fila.cliente}» vs ficha «${ficha.cliente}» (folio ${fila.folio})`);
  }
}
if (desbordadas.length) {
  console.log("\nDESBORDADAS — el Excel trae más cinturones de ese folio que el CRM; revisar a mano:");
  for (const fila of desbordadas) {
    console.log(`  ${fila.pestana} fila ${fila.fila}: ${fila.no_venta} «${fila.cliente}»`);
  }
}

const camposTocados = {};
for (const { patch } of rellenos) for (const c of Object.keys(patch)) camposTocados[c] = (camposTocados[c] ?? 0) + 1;
if (rellenos.length) console.log("\nCampos que se rellenan:", JSON.stringify(camposTocados));

console.log("\nMuestra de altas (primeras 5):");
for (const { fila } of altas.slice(0, 5)) {
  console.log(
    `  ${fila.pestana} fila ${String(fila.fila).padStart(3)}  ${(fila.no_venta ?? "—").padEnd(20)} ${fila.cliente.padEnd(34)}` +
      ` ${(fila.tipo ?? "—").padEnd(10)} ${(fila.modelo ?? "—").padEnd(10)} compra=${fila.fecha_compra ?? "—"} ${fila.media ? "img" : ""}`,
  );
}

if (!EJECUTAR) {
  console.log("\n(Prueba en seco: no se tocó nada. Repite con --ejecutar cuando el plan se vea bien.)");
  limpiarTmp();
  process.exit(0);
}

/* ==========================================================================
   5. Ejecutar
   ========================================================================== */

/* Altas por lotes, idempotentes por la unicidad de `clave`. */
for (let i = 0; i < altas.length; i += TAM_LOTE_UPSERT) {
  const lote = altas.slice(i, i + TAM_LOTE_UPSERT).map((a) => a.insercion);
  const { error } = await admin.from("personalizados").upsert(lote, { onConflict: "clave" });
  if (error) {
    console.error("\nNo se pudieron guardar las altas:", error.message);
    limpiarTmp();
    process.exit(1);
  }
}
console.log(`\nGuardadas ${altas.length} altas.`);

/* Rellenos, uno por uno: cada ficha lleva su propio parche. */
let rellenadas = 0;
for (const { fila, ficha, patch } of rellenos) {
  const { error } = await admin.from("personalizados").update(patch).eq("id", ficha.id);
  if (error) {
    console.error(`  FALLA relleno ${fila.pestana} fila ${fila.fila} (${fila.cliente}): ${error.message}`);
    continue;
  }
  rellenadas++;
}
console.log(`Rellenadas ${rellenadas} fichas.`);

/* Los ids de las altas, para colgarles su foto. */
const idPorClave = new Map();
for (let desde = 0; ; desde += 1000) {
  const { data, error } = await admin
    .from("personalizados")
    .select("id, clave")
    .like("clave", "cintos26-%")
    .order("id")
    .range(desde, desde + 999);
  if (error) {
    console.error("No se pudieron releer las altas:", error.message);
    limpiarTmp();
    process.exit(1);
  }
  for (const p of data) idPorClave.set(p.clave, p.id);
  if (data.length < 1000) break;
}

const TIPOS_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
let subidas = 0;
let fallosFoto = 0;
for (const pend of fotosPend) {
  const id = pend.fichaId ?? idPorClave.get(pend.fila.clave);
  if (!id) continue;

  const ext = (pend.fila.media.split(".").pop() ?? "png").toLowerCase();
  /* Ruta derivada del id: repetir el script reemplaza el binario en vez de
     dejar copias huérfanas en el bucket. */
  const ruta = `${id}/diseno-hoja.${ext}`;

  const { error: errSubida } = await admin.storage
    .from("personalizados")
    .upload(ruta, readFileSync(join(dir, pend.fila.media)), {
      contentType: TIPOS_MIME[ext] ?? "application/octet-stream",
      upsert: true,
    });
  if (errSubida) {
    console.error(`  FALLA imagen ${pend.fila.pestana} fila ${pend.fila.fila} (${pend.fila.cliente}): ${errSubida.message}`);
    fallosFoto++;
    continue;
  }

  const { error: errFicha } = await admin.from("personalizados").update({ foto_path: ruta }).eq("id", id);
  if (errFicha) {
    await admin.storage.from("personalizados").remove([ruta]);
    console.error(`  FALLA ficha ${pend.fila.pestana} fila ${pend.fila.fila} (${pend.fila.cliente}): ${errFicha.message}`);
    fallosFoto++;
    continue;
  }
  subidas++;
}

console.log(`Subidos ${subidas} diseños${fallosFoto ? `, ${fallosFoto} con error` : ""}.`);
limpiarTmp();
