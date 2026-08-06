/* ============================================================================
   scripts/importar-recepcion-xlsx.mjs
   ----------------------------------------------------------------------------
   Carga al CRM una hoja «Recepción FRESA FIT» descargada como .xlsx: crea la
   carga en Bodega → Recepción y sus renglones, uno por SKU y talla.

   POR QUÉ NO SE PEGA Y YA:
   El importador de la pantalla («Pegar renglones») espera una tabla plana —un
   renglón por SKU—, y esta hoja no lo es: es una CUADRÍCULA de bloques. Cada
   producto ocupa un recuadro con su foto, su título «Nombre - SKU» y una
   tablita de cuatro tallas, y en cada fila caben cuatro recuadros lado a lado
   (dos de POWERLIFT y dos de HEBILLA). Copiar eso a un textarea entrega las
   cuatro tablas entreveradas y sin saber a qué SKU pertenece cada columna.

   Aquí se lee por celda: el título del bloque manda sobre la tablita que tiene
   a su derecha, y de ahí sale el SKU de cada talla (SBD002 + CH = SBD002CH).

   Cómo se consigue el .xlsx:
     En el Sheet → Archivo → Descargar → Microsoft Excel (.xlsx)

   Uso (Node 20+):
     # 1. Ver el plan completo sin tocar nada. SIEMPRE correr esto primero.
     node --env-file=.env.local scripts/importar-recepcion-xlsx.mjs \
       --archivo "Recepción FRESA FIT.xlsx"

     # 2. Ejecutarlo.
     node --env-file=.env.local scripts/importar-recepcion-xlsx.mjs \
       --archivo "…" --ejecutar

   Opciones:
     --hoja "Supervisor"   Cuál de las hojas se lee (por defecto, la primera con
                           bloques: la del supervisor es la que trae las
                           cantidades; la de encargados se llena en el piso).
     --titulo "…"          Nombre de la carga. Por defecto, el pedido y el lote
                           de la cabecera de la hoja.
     --canal tienda_nube   La «plantilla» de la carga (tienda_nube o
                           mercado_libre); es lo único que acepta la tabla.
     --incluir-ceros       Trae también las tallas con 0. Por defecto se omiten:
                           un renglón de cero no suma stock ni se checa.
     --reemplazar          Si ya existe una carga con ese título, borra sus
                           renglones y la recarga. Se niega si alguno ya está
                           descontado (el stock ya se movió).

   Qué unidades entran: manda REAL —lo que de verdad se contó al recibir— y
   donde REAL está vacía entra EDU., lo que el proveedor dijo que mandaba. Los
   renglones que vienen de REAL nacen «checado» (ya se contaron, falta sumarlos
   al stock) y los que vienen de EDU. nacen «traer», que es como los espera el
   piso. El stock NO se toca aquí: eso sigue siendo el botón «Descontar
   checados» de la pantalla.

   Requiere en el entorno:
     NEXT_PUBLIC_SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY   (service role — NUNCA en el cliente ni en git)
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { rmSync } from "node:fs";
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
const INCLUIR_CEROS = args["incluir-ceros"] === true;
const CANAL = typeof args.canal === "string" ? args.canal : "tienda_nube";

if (!args.archivo || args.archivo === true) {
  console.error("Falta --archivo con la ruta al .xlsx descargado del Sheet.");
  process.exit(1);
}
if (!existsSync(args.archivo)) {
  console.error(`No existe el archivo: ${args.archivo}`);
  process.exit(1);
}
if (!["tienda_nube", "mercado_libre"].includes(CANAL)) {
  console.error(`--canal solo acepta tienda_nube o mercado_libre (llegó «${CANAL}»).`);
  process.exit(1);
}

/* ==========================================================================
   1. Leer el .xlsx
   --------------------------------------------------------------------------
   Con expresiones regulares y no con una librería de XML, igual que el
   importador de personalizados: son tres archivos de forma muy acotada y no
   vale la pena cargar una dependencia por algo que se corre a mano.
   ========================================================================== */

const dir = mkdtempSync(join(tmpdir(), "recepcion-"));
const limpiar = () => rmSync(dir, { recursive: true, force: true });
const morir = (...mensaje) => {
  console.error(...mensaje);
  limpiar();
  process.exit(1);
};

try {
  execFileSync("unzip", ["-qo", args.archivo, "-d", dir, "-x", "xl/media/*"]);
} catch (e) {
  morir("No se pudo descomprimir el .xlsx:", e.message);
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

/* Nombre de hoja → archivo, resolviendo por las relaciones del libro (el orden
   de los sheetN.xml NO es el orden de las pestañas). */
const relsLibro = new Map();
for (const m of (leer("xl/_rels/workbook.xml.rels") ?? "").matchAll(
  /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g,
)) {
  relsLibro.set(m[1], m[2].replace(/^\/?/, "").replace(/^xl\//, ""));
}
const hojas = [];
for (const m of (leer("xl/workbook.xml") ?? "").matchAll(/<sheet[^>]*\/>/g)) {
  const nombre = desescapar(/name="([^"]*)"/.exec(m[0])?.[1] ?? "");
  const rId = /r:id="([^"]+)"/.exec(m[0])?.[1];
  const destino = relsLibro.get(rId);
  if (nombre && destino) hojas.push({ nombre, ruta: `xl/${destino}` });
}
if (!hojas.length) morir("El .xlsx no trae hojas.");

/* Celdas de una hoja: "A9" → texto ya desescapado. */
function celdasDe(ruta) {
  const xml = leer(ruta);
  if (!xml) return null;
  const celdas = new Map();
  for (const m of xml.matchAll(/<c\s+r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, ref, atributos, cuerpo] = m;
    if (cuerpo === undefined) continue;
    const valor = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
    if (valor === undefined) continue;
    const texto = / t="s"/.test(atributos)
      ? (cadenas[Number(valor)] ?? "")
      : desescapar(valor);
    const limpio = texto.replace(/\s+/g, " ").trim();
    if (limpio) celdas.set(ref, limpio);
  }
  return celdas;
}

const columna = (ref) => /^[A-Z]+/.exec(ref)[0];
const fila = (ref) => Number(/\d+$/.exec(ref)[0]);
const numCol = (letras) => [...letras].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
const letraCol = (n) => {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
const normalizar = (s) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const normalizarSku = (s) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

/* ==========================================================================
   2. Encontrar los bloques de la plantilla
   --------------------------------------------------------------------------
   Un bloque es: un título «Nombre - SKU» y, debajo, una tablita cuyo
   encabezado es TALLA + una o dos columnas de cantidad. La tablita empieza dos
   columnas a la derecha del título (ahí va la foto), pero eso no se da por
   hecho: cada encabezado TALLA busca su título en la fila de arriba, en la
   celda escrita más cercana por la izquierda.
   ========================================================================== */

const ETIQUETAS_CABECERA = [
  "F. DE RECEPCION",
  "PROVEEDOR",
  "PEDIDO",
  "LOTE",
  "SUPERVISOR",
  "ENCARGADO",
  "ENCARGADO/S",
  "OBSERVACIONES",
];

const TALLAS = ["CH", "M", "G", "EG", "XS", "S", "L", "XL", "XXL", "UNITALLA"];

function bloquesDe(celdas) {
  /* fila → [refs ordenadas por columna] */
  const porFila = new Map();
  for (const ref of celdas.keys()) {
    const f = fila(ref);
    if (!porFila.has(f)) porFila.set(f, []);
    porFila.get(f).push(ref);
  }
  for (const refs of porFila.values()) {
    refs.sort((a, b) => numCol(columna(a)) - numCol(columna(b)));
  }

  /* Las secciones de la hoja (POWERLIFT, HEBILLA): texto suelto, sin SKU y sin
     tablita debajo en su misma columna. Cada bloque hereda la sección abierta
     más cercana por la izquierda. */
  const secciones = [];
  for (const [f, refs] of [...porFila].sort((a, b) => a[0] - b[0])) {
    for (const ref of refs) {
      const valor = celdas.get(ref);
      if (/-\s*[A-Z]{2,5}\d{2,5}$/i.test(valor)) continue;
      if (ETIQUETAS_CABECERA.includes(normalizar(valor))) continue;
      if (normalizar(valor) === "TALLA" || TALLAS.includes(normalizar(valor))) continue;
      if (!/^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{3,}$/.test(valor)) continue;
      secciones.push({ fila: f, col: numCol(columna(ref)), nombre: valor });
    }
  }
  const seccionDe = (f, col) => {
    const candidatas = secciones.filter((s) => s.fila < f && s.col <= col);
    if (!candidatas.length) return null;
    /* La más pegada al bloque: primero por columna, luego la más reciente. */
    candidatas.sort((a, b) => b.col - a.col || b.fila - a.fila);
    return candidatas[0].nombre;
  };

  const bloques = [];
  for (const [f, refs] of [...porFila].sort((a, b) => a[0] - b[0])) {
    for (const ref of refs) {
      if (normalizar(celdas.get(ref)) !== "TALLA") continue;
      const colTalla = numCol(columna(ref));

      /* El título: en la fila de arriba, la celda escrita más cercana por la
         izquierda que traiga un SKU al final. */
      const arriba = (porFila.get(f - 1) ?? []).filter((r) => numCol(columna(r)) <= colTalla);
      const refTitulo = arriba.at(-1);
      const titulo = refTitulo ? celdas.get(refTitulo) : null;
      const m = titulo ? /^(.*?)[\s-]+([A-Za-z]{2,5}\d{2,5})$/.exec(titulo) : null;
      if (!m) {
        bloques.push({ fila: f, titulo, error: "sin SKU en el título" });
        continue;
      }

      /* Los encabezados de cantidad, a la derecha de TALLA. */
      const encabezados = [];
      for (let i = 1; i <= 2; i++) {
        const valor = celdas.get(`${letraCol(colTalla + i)}${f}`);
        if (valor) encabezados.push({ col: colTalla + i, nombre: normalizar(valor) });
      }

      /* Las tallas, hacia abajo, hasta que la columna deje de traerlas. */
      const renglones = [];
      for (let ff = f + 1; ff <= f + 12; ff++) {
        const talla = celdas.get(`${letraCol(colTalla)}${ff}`);
        if (!talla || !TALLAS.includes(normalizar(talla))) break;
        const valores = {};
        for (const e of encabezados) {
          const bruto = celdas.get(`${letraCol(e.col)}${ff}`);
          const n = bruto === undefined ? null : Number(bruto);
          valores[e.nombre] = Number.isFinite(n) ? n : null;
        }
        renglones.push({ talla: normalizar(talla), valores });
      }

      /* La celda de la foto (a la izquierda de TALLA) a veces dice «NO EXISTE»:
         así marca bodega el modelo que todavía no tiene ficha. */
      const marca = celdas.get(`${letraCol(colTalla - 2)}${f}`) ?? "";

      bloques.push({
        fila: f,
        nombre: m[1].trim(),
        sku: m[2].toUpperCase(),
        seccion: seccionDe(f, colTalla),
        encabezados: encabezados.map((e) => e.nombre),
        renglones,
        noExiste: normalizar(marca).replace(/\s+/g, " ") === "NO EXISTE",
      });
    }
  }
  return bloques;
}

/* La hoja a leer: la pedida por --hoja, o la primera que traiga bloques con
   cantidades (la del supervisor; la de encargados viene en blanco). */
const candidatas = hojas
  .map((h) => {
    const celdas = celdasDe(h.ruta);
    if (!celdas) return null;
    const bloques = bloquesDe(celdas);
    const unidades = bloques.reduce(
      (acc, b) =>
        acc + (b.renglones ?? []).reduce((a, r) => a + Object.values(r.valores).reduce((x, v) => x + (v ?? 0), 0), 0),
      0,
    );
    return { ...h, celdas, bloques, unidades };
  })
  .filter(Boolean);

const hoja =
  typeof args.hoja === "string"
    ? candidatas.find((h) => normalizar(h.nombre) === normalizar(args.hoja))
    : [...candidatas].sort((a, b) => b.unidades - a.unidades)[0];

if (!hoja) {
  morir(
    `No se encontró la hoja${typeof args.hoja === "string" ? ` «${args.hoja}»` : ""}. ` +
      `Las del archivo son: ${candidatas.map((h) => h.nombre).join(", ")}.`,
  );
}

console.log(`Archivo: ${args.archivo}`);
console.log(`Hojas:   ${candidatas.map((h) => `${h.nombre} (${h.unidades} u.)`).join(" · ")}`);
console.log(`Se lee:  ${hoja.nombre}\n`);

/* ==========================================================================
   3. La cabecera de la hoja (proveedor, pedido, lote, quién la firma)
   ========================================================================== */

/* Los números de serie de Excel cuentan días desde el 30/12/1899. */
function fechaDeSerial(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

const cabecera = {};
for (const [ref, valor] of hoja.celdas) {
  const etiqueta = normalizar(valor).replace(/:$/, "");
  if (!ETIQUETAS_CABECERA.includes(etiqueta)) continue;
  const f = fila(ref);
  const desde = numCol(columna(ref));
  /* El valor va en la misma fila, a la derecha (la plantilla lo pone en C). */
  for (let i = 1; i <= 4; i++) {
    const v = hoja.celdas.get(`${letraCol(desde + i)}${f}`);
    if (v) {
      cabecera[etiqueta] = v;
      break;
    }
  }
}

const pedido = cabecera["PEDIDO"] ?? null;
const lote = cabecera["LOTE"] ?? null;
const proveedor = cabecera["PROVEEDOR"] ?? null;
const fechaRecepcion = cabecera["F. DE RECEPCION"] ? fechaDeSerial(cabecera["F. DE RECEPCION"]) : null;
const supervisor = cabecera["SUPERVISOR"] ?? null;
const encargado = cabecera["ENCARGADO/S"] ?? cabecera["ENCARGADO"] ?? null;

/* «1.0» es como Excel guarda el 1 del lote. */
const loteLimpio = lote && /^\d+(\.0+)?$/.test(lote) ? String(Number(lote)) : lote;

const titulo =
  typeof args.titulo === "string"
    ? args.titulo
    : pedido
      ? [`Recepción ${pedido}`, loteLimpio && loteLimpio !== "-" ? `lote ${loteLimpio}` : null]
          .filter(Boolean)
          .join(" · ")
      : `Recepción ${hoja.nombre}`;

const notas = [
  proveedor && `Proveedor: ${proveedor}`,
  pedido && `Pedido: ${pedido}`,
  loteLimpio && loteLimpio !== "-" && `Lote: ${loteLimpio}`,
  fechaRecepcion && `F. de recepción: ${fechaRecepcion}`,
  supervisor && `Supervisor: ${supervisor}`,
  encargado && `Encargado/s: ${encargado}`,
  `Importado de «${args.archivo.split("/").pop()}» (hoja ${hoja.nombre}).`,
]
  .filter(Boolean)
  .join("\n");

console.log("=== Cabecera de la hoja ===");
console.log(`Título de la carga: ${titulo}`);
console.log(notas.replace(/^/gm, "  "));

/* ==========================================================================
   4. Los bloques → renglones de la carga
   ========================================================================== */

const malos = hoja.bloques.filter((b) => b.error);
const buenos = hoja.bloques.filter((b) => !b.error);

/* Cuál columna manda: REAL (lo contado) sobre EDU. (lo anunciado). La hoja de
   encargados usa CANT. y DEF. (defectuosos): ahí manda CANT. y los defectuosos
   solo se reportan, porque un defectuoso llegó —se recibe y luego se decide—. */
const COL_CONTADO = ["REAL", "FINAL", "RECIBIDO"];
const COL_ESPERADO = ["EDU.", "EDU", "CANT.", "CANT", "CANTIDAD", "ESPERADO"];
const COL_DEFECTO = ["DEF.", "DEF", "DEFECTUOSOS"];

const renglones = [];
const ceros = [];
let defectuosos = 0;

for (const b of buenos) {
  for (const r of b.renglones) {
    let unidades = null;
    let origen = null;
    for (const [nombre, valor] of Object.entries(r.valores)) {
      if (valor === null) continue;
      if (COL_CONTADO.includes(nombre)) {
        unidades = valor;
        origen = "REAL";
      } else if (COL_ESPERADO.includes(nombre) && unidades === null) {
        unidades = valor;
        origen = "EDU.";
      } else if (COL_DEFECTO.includes(nombre)) {
        defectuosos += valor;
      }
    }
    if (unidades === null) continue;

    const fila = {
      sku: `${b.sku}${r.talla}`,
      sku_consolidado: b.sku,
      talla: r.talla,
      producto_nombre: b.nombre,
      categoria: b.seccion,
      unidades: Math.round(unidades),
      origen,
      noExiste: b.noExiste,
    };
    if (fila.unidades === 0 && !INCLUIR_CEROS) ceros.push(fila);
    else renglones.push(fila);
  }
}

console.log(`\n=== La hoja ===`);
console.log(`Bloques (producto):     ${buenos.length}`);
console.log(`Renglones (SKU+talla):  ${renglones.length}${ceros.length ? `  (+${ceros.length} en cero, omitidos)` : ""}`);
console.log(`Unidades:               ${renglones.reduce((a, r) => a + r.unidades, 0)}`);
console.log(`  contadas (REAL):      ${renglones.filter((r) => r.origen === "REAL").reduce((a, r) => a + r.unidades, 0)}`);
console.log(`  anunciadas (EDU.):    ${renglones.filter((r) => r.origen === "EDU.").reduce((a, r) => a + r.unidades, 0)}`);
if (defectuosos) console.log(`Defectuosos anotados:   ${defectuosos} (no se restan: llegaron)`);

if (malos.length) {
  console.log(`\nBloques que no se pudieron leer (${malos.length}):`);
  for (const b of malos) console.log(`  fila ${b.fila}: ${b.error} — «${b.titulo ?? ""}»`);
}
const sinFicha = [...new Set(buenos.filter((b) => b.noExiste).map((b) => `${b.nombre} (${b.sku})`))];
if (sinFicha.length) {
  console.log(`\nMarcados «NO EXISTE» en la hoja: ${sinFicha.join(", ")}`);
}

if (!renglones.length) morir("\nNo hay ni un renglón con unidades: no hay nada que importar.");

/* ==========================================================================
   5. Contra el catálogo del CRM
   ========================================================================== */

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

/* El catálogo entero, paginado: PostgREST corta en 1000 filas sin avisar. */
const productos = [];
for (let desde = 0; ; desde += 1000) {
  const { data, error } = await admin
    .from("products")
    .select("id, sku, nombre, activo, stock")
    .order("sku")
    .range(desde, desde + 999);
  if (error) morir("No se pudo leer el catálogo:", error.message);
  productos.push(...data);
  if (data.length < 1000) break;
}

/* products.sku NO es único (hay fichas duplicadas, y de las viejas varias
   quedaron inactivas). Con dos fichas activas para el mismo SKU no se elige a
   ciegas: el renglón entra sin ficha y se reporta, que es lo mismo que hace el
   importador de la pantalla. */
const porSku = new Map();
for (const p of productos) {
  if (!p.sku) continue;
  const k = normalizarSku(p.sku);
  if (!porSku.has(k)) porSku.set(k, []);
  porSku.get(k).push(p);
}

const ambiguos = [];
const huerfanos = [];
for (const r of renglones) {
  const candidatos = porSku.get(normalizarSku(r.sku)) ?? [];
  const activos = candidatos.filter((p) => p.activo);
  const elegibles = activos.length ? activos : candidatos;
  if (elegibles.length === 1) {
    r.producto_id = elegibles[0].id;
    r.nombre_catalogo = elegibles[0].nombre;
  } else if (elegibles.length > 1) {
    r.producto_id = null;
    ambiguos.push({ ...r, candidatos: elegibles });
  } else {
    r.producto_id = null;
    huerfanos.push(r);
  }
}

console.log(`\n=== Contra el catálogo ===`);
console.log(`Renglones con ficha:        ${renglones.filter((r) => r.producto_id).length}`);
console.log(`Con SKU repetido (ambiguo): ${ambiguos.length}`);
console.log(`Sin ficha en el catálogo:   ${huerfanos.length}`);
if (ambiguos.length) {
  /* El SKU repetido no es cosa del script: son fichas duplicadas del catálogo,
     y el renglón no puede elegir por su cuenta a cuál de las dos sumarle.
     Se listan con su stock para poder unificarlas en Inventario y volver a
     correr esto con --reemplazar. */
  const porSkuBase = new Map();
  for (const r of ambiguos) {
    if (!porSkuBase.has(r.sku_consolidado)) porSkuBase.set(r.sku_consolidado, []);
    porSkuBase.get(r.sku_consolidado).push(r);
  }
  console.log("  entran SIN ficha: al descontarlos no moverán stock hasta unificar las fichas.");
  for (const [base, filas] of porSkuBase) {
    const muestra = filas[0];
    console.log(
      `  ${base} (${filas.map((f) => f.talla).join("/")}) — ${muestra.candidatos.length} fichas para ${muestra.sku}:`,
    );
    for (const c of muestra.candidatos) {
      console.log(
        `      ${c.activo ? "activa  " : "inactiva"} stock=${String(c.stock).padStart(3)}  ${c.nombre.slice(0, 60)}`,
      );
    }
  }
}
if (huerfanos.length) {
  console.log(`  sin ficha: ${[...new Set(huerfanos.map((r) => r.sku))].join(", ")}`);
}

/* ==========================================================================
   6. Contra las cargas que ya hay
   ========================================================================== */

const { data: previas, error: errPrevias } = await admin
  .from("recepciones_bodega")
  .select("id, titulo, estado, created_at")
  .eq("titulo", titulo);
if (errPrevias) morir("No se pudieron leer las cargas:", errPrevias.message);

let recepcionId = previas?.[0]?.id ?? null;
if (recepcionId) {
  const { count, error: errCuenta } = await admin
    .from("recepcion_items")
    .select("id", { count: "exact", head: true })
    .eq("recepcion_id", recepcionId);
  if (errCuenta) morir("No se pudieron contar los renglones de la carga previa:", errCuenta.message);
  console.log(`\nYa existe la carga «${titulo}» con ${count ?? 0} renglones.`);
  if (!REEMPLAZAR) {
    console.log(
      "  Volver a cargarla sin más dejaría los renglones duplicados.\n" +
        "  Añade --reemplazar para borrar los suyos y recargarlos, o --titulo «otro nombre».",
    );
    if (!EJECUTAR) console.log("\n(Prueba en seco: no se tocó nada.)");
    limpiar();
    process.exit(EJECUTAR ? 1 : 0);
  }
  const { count: yaDescontados } = await admin
    .from("recepcion_items")
    .select("id", { count: "exact", head: true })
    .eq("recepcion_id", recepcionId)
    .eq("estado", "descontado");
  if (yaDescontados) {
    morir(
      `  ${yaDescontados} de sus renglones YA están descontados: su stock ya se sumó al catálogo.\n` +
        "  Borrarlos y recargarlos dejaría la carga diciendo que falta sumar algo que ya se sumó.\n" +
        "  Usa --titulo «…» para dejarla como está y crear una carga aparte.",
    );
  }
}

console.log(`\n=== Se va a ${recepcionId ? "RECARGAR" : "crear"} ===`);
console.log(`Carga:      ${titulo} (${CANAL}, abierta)`);
console.log(`Renglones:  ${renglones.length}`);
console.log(`  «checado» (contados, listos para sumar al stock): ${renglones.filter((r) => r.origen === "REAL").length}`);
console.log(`  «traer»   (anunciados, faltan por contar):        ${renglones.filter((r) => r.origen === "EDU.").length}`);
console.log("\nPrimeros 8:");
for (const r of renglones.slice(0, 8)) {
  console.log(
    `  ${r.sku.padEnd(10)} ${String(r.unidades).padStart(3)} u.  ${(r.categoria ?? "—").padEnd(10)}` +
      ` ${(r.nombre_catalogo ?? r.producto_nombre).slice(0, 44).padEnd(44)} ${r.producto_id ? "" : "SIN FICHA"}`,
  );
}
console.log(`  … y ${Math.max(0, renglones.length - 8)} más.`);
console.log("\nEl stock NO se toca: eso es «Descontar checados» en la pantalla.");

if (!EJECUTAR) {
  console.log("\n(Prueba en seco: no se tocó nada. Repite con --ejecutar cuando el plan se vea bien.)");
  limpiar();
  process.exit(0);
}

/* ==========================================================================
   7. Ejecutar
   ========================================================================== */

if (recepcionId) {
  const { error } = await admin.from("recepcion_items").delete().eq("recepcion_id", recepcionId);
  if (error) morir("No se pudieron borrar los renglones previos:", error.message);
  const { error: errNotas } = await admin
    .from("recepciones_bodega")
    .update({ canal: CANAL, notas })
    .eq("id", recepcionId);
  if (errNotas) morir("No se pudo actualizar la carga:", errNotas.message);
  console.log(`\nRenglones previos retirados de «${titulo}».`);
} else {
  const { data, error } = await admin
    .from("recepciones_bodega")
    .insert({ titulo, canal: CANAL, estado: "abierta", notas })
    .select("id")
    .single();
  if (error) morir("No se pudo crear la carga:", error.message);
  recepcionId = data.id;
  console.log(`\nCarga creada: ${titulo}`);
}

/* De a 500, que es lo que aguanta cómodo un insert de PostgREST. */
let guardados = 0;
for (let i = 0; i < renglones.length; i += 500) {
  const lote = renglones.slice(i, i + 500).map((r) => ({
    recepcion_id: recepcionId,
    sku: r.sku,
    producto_id: r.producto_id,
    unidades_no_procesadas: r.unidades,
    sku_consolidado: r.sku_consolidado,
    categoria: r.categoria,
    producto_nombre: r.nombre_catalogo ?? r.producto_nombre,
    talla: r.talla,
    estado: r.origen === "REAL" ? "checado" : "traer",
  }));
  const { error } = await admin.from("recepcion_items").insert(lote);
  if (error) morir(`No se pudieron guardar los renglones (a partir del ${i + 1}):`, error.message);
  guardados += lote.length;
}

console.log(`Guardados ${guardados} renglones.`);
console.log("Míralos en el CRM: Bodega → Recepción.");
limpiar();
