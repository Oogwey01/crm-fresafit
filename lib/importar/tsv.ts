/* ============================================================================
   lib/importar/tsv.ts  —  Pegar desde Excel / Google Sheets
   ----------------------------------------------------------------------------
   Todo lo que el equipo trae de fuera vive hoy en hojas de cálculo (bodega,
   pedidos a proveedor, el formulario de influencers). Copiar una selección de
   Sheets o Excel entrega columnas separadas por TABULADOR, no por "|": estos
   helpers son la base común de los tres importadores para que peguen igual y
   fallen igual (marcando en ámbar en vez de rechazar la fila).
   ============================================================================ */

/* Normaliza para comparar texto sin acentos ni mayúsculas. Mismo criterio que
   el importador de tareas (components/tareas/importar.tsx). */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/* Un SKU pegado trae espacios, guiones bajos y minúsculas según quién lo
   escribió: para comparar se deja solo alfanumérico en mayúsculas. */
export function normalizarSku(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

/* Divide el texto pegado en filas de celdas. Si la primera fila parece el
   encabezado de la hoja (coincide con los nombres esperados), se descarta:
   copiar incluyendo el encabezado es lo normal y no debería crear una fila
   basura. */
export function parsearTSV(texto: string, encabezados: string[] = []): string[][] {
  const filas = texto
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim())
    .map((l) => l.split("\t").map((c) => c.trim()));

  if (!filas.length) return [];
  if (encabezados.length && esEncabezado(filas[0], encabezados)) return filas.slice(1);
  return filas;
}

/* ¿La fila es el encabezado de la hoja? Basta con que la mitad de sus celdas
   coincida con alguno de los nombres esperados: las hojas del equipo tienen
   columnas de más y con títulos distintos según la versión. */
function esEncabezado(fila: string[], encabezados: string[]): boolean {
  const esperados = encabezados.map(norm);
  const conTexto = fila.filter(Boolean);
  if (!conTexto.length) return false;
  const aciertos = conTexto.filter((c) => esperados.includes(norm(c))).length;
  return aciertos >= Math.ceil(conTexto.length / 2);
}

/* Número de una celda: tolera separador de millares, símbolo de moneda,
   espacios y coma decimal. Vacío → null (no es un error, es "no lo pusieron"). */
export function parsearNumero(s: string): number | null {
  const limpio = (s ?? "").replace(/[$\s]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/* Entero no negativo (cantidades). Vacío o inválido → null. */
export function parsearCantidad(s: string): number | null {
  const n = parsearNumero(s);
  if (n === null) return null;
  const entero = Math.round(n);
  return entero >= 0 ? entero : null;
}

/* Los seguidores del formulario de influencers vienen escritos a mano:
   "32mil", "8.2", "10,800 seguidores y 2.1M likes", "1.2M". Nunca se rechaza la
   fila: se devuelve el mejor número posible y `sospechoso` para pintarlo ámbar
   y que un humano lo confirme. */
export function parsearSeguidores(s: string): { valor: number | null; sospechoso: boolean } {
  const crudo = (s ?? "").trim();
  if (!crudo) return { valor: null, sospechoso: false };

  const t = norm(crudo).replace(/,(?=\d{3}\b)/g, "");
  /* Primer número del texto + el sufijo pegado a él ("32mil", "1.2 m", "850k"). */
  const m = t.match(/(\d+(?:[.]\d+)?)\s*(mill?ones?|mil|m|k)?/);
  if (!m) return { valor: null, sospechoso: true };

  const base = Number(m[1]);
  if (!Number.isFinite(base)) return { valor: null, sospechoso: true };

  const sufijo = m[2] ?? "";
  /* Hay más texto del que se interpretó ("y 2.1M likes"): número usable pero
     conviene revisarlo. */
  const sobra = t.replace(m[0], "").replace(/seguidores?|de|en|aprox\.?/g, "").trim().length > 0;

  if (/^mill?ones?$|^m$/.test(sufijo)) return { valor: Math.round(base * 1_000_000), sospechoso: sobra };
  if (/^mil$|^k$/.test(sufijo)) return { valor: Math.round(base * 1_000), sospechoso: sobra };

  /* Sin sufijo: "8.2" o "8,2" en una columna de seguidores casi siempre son
     miles (nadie tiene 8 seguidores en un formulario de convocatoria), pero se
     marca para que lo confirmen. */
  if (base < 1000 && !Number.isInteger(base)) return { valor: Math.round(base * 1_000), sospechoso: true };
  if (base < 100) return { valor: Math.round(base * 1_000), sospechoso: true };

  return { valor: Math.round(base), sospechoso: sobra };
}

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/* Fecha de una celda de hoja de cálculo, en cualquiera de las formas en que el
   equipo las escribe: "2026-07-19", "19/07/2026", "19/07/26", "6 / jul / 26" y
   —la más común y la más incómoda— "19 jul", sin año.

   Cuando no hay año se toma el del `hoy` que se le pase, y si eso deja la fecha
   más de medio año en el pasado se pasa al siguiente: en una hoja que se lleva
   al día, "19 ene" escrito en diciembre es enero del año que entra, no el que
   ya pasó. Es una suposición, así que la vista previa la enseña resuelta antes
   de guardar nada. */
export function parsearFecha(s: string, hoy: string): string | null {
  const crudo = (s ?? "").trim();
  if (!crudo) return null;

  const iso = crudo.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return armarFecha(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  /* Numérica con separadores: día primero, como se escribe en México. */
  const num = crudo.match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})$/);
  if (num) {
    const anio = Number(num[3]);
    return armarFecha(anio < 100 ? 2000 + anio : anio, Number(num[2]), Number(num[1]));
  }

  /* Con nombre de mes, con año ("6 / jul / 26") o sin él ("19 jul"). */
  const conMes = norm(crudo).match(/^(\d{1,2})\s*[/\s.-]+\s*([a-z]+)\.?(?:\s*[/\s.-]+\s*(\d{2,4}))?$/);
  if (!conMes) return null;

  const mes = MESES.findIndex((m) => conMes[2].startsWith(m));
  if (mes < 0) return null;
  const dia = Number(conMes[1]);

  if (conMes[3]) {
    const anio = Number(conMes[3]);
    return armarFecha(anio < 100 ? 2000 + anio : anio, mes + 1, dia);
  }

  const anioHoy = Number(hoy.slice(0, 4));
  const candidata = armarFecha(anioHoy, mes + 1, dia);
  if (!candidata) return null;
  return candidata < sumarMeses(hoy, -6) ? armarFecha(anioHoy + 1, mes + 1, dia) : candidata;
}

function armarFecha(anio: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function sumarMeses(fecha: string, n: number): string {
  const [a, m] = fecha.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/* Handle de red social desde lo que sea que hayan pegado: "@fresafit",
   "fresafit", "https://instagram.com/fresafit?igsh=…", "tiktok.com/@fresafit". */
export function parsearHandle(s: string): string | null {
  const crudo = (s ?? "").trim();
  if (!crudo) return null;
  const sinUrl = crudo
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/^(instagram|tiktok)\.com\//i, "")
    .split(/[?#/\s]/)[0];
  const handle = sinUrl.replace(/^@+/, "").trim();
  return handle ? `@${handle}` : null;
}

/* ---------------------------------------------------------------------------
   Emparejar un SKU pegado contra el catálogo.

   `products.sku` NO es único (el módulo de inventario tiene su propio detector
   de fichas duplicadas), así que esto nunca elige en silencio cuando hay más de
   un candidato: devuelve los `candidatos` para que la vista pida desambiguar.
   --------------------------------------------------------------------------- */
export type ProductoParaMatch = { id: string; sku: string | null; nombre?: string | null };

export type MatchSku<T extends ProductoParaMatch> = {
  producto: T | null;
  /* "exacto" = el SKU es idéntico; "parcial" = uno contiene al otro (revisar);
     "ambiguo" = varios candidatos; "ninguno" = no está en el catálogo. */
  tipo: "exacto" | "parcial" | "ambiguo" | "ninguno";
  candidatos: T[];
};

export function matchProductoPorSku<T extends ProductoParaMatch>(
  sku: string,
  productos: T[],
): MatchSku<T> {
  const objetivo = normalizarSku(sku);
  if (!objetivo) return { producto: null, tipo: "ninguno", candidatos: [] };

  const exactos = productos.filter((p) => p.sku && normalizarSku(p.sku) === objetivo);
  if (exactos.length === 1) return { producto: exactos[0], tipo: "exacto", candidatos: exactos };
  if (exactos.length > 1) return { producto: null, tipo: "ambiguo", candidatos: exactos };

  const parciales = productos.filter((p) => {
    if (!p.sku) return false;
    const s = normalizarSku(p.sku);
    return s.startsWith(objetivo) || objetivo.startsWith(s);
  });
  if (parciales.length === 1) return { producto: parciales[0], tipo: "parcial", candidatos: parciales };
  if (parciales.length > 1) return { producto: null, tipo: "ambiguo", candidatos: parciales };

  return { producto: null, tipo: "ninguno", candidatos: [] };
}
