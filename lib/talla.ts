/* ============================================================================
   lib/talla.ts — Extraer y ordenar la TALLA a partir de la variante libre.
   ----------------------------------------------------------------------------
   La talla no vive en su propia columna: es parte del texto libre de
   `products.variante` ("Rosa / M", "Negro / 32", "Chica"). Para las métricas por
   talla se parsea con una heurística: se toma el segmento (separado por "/") que
   se parece a una talla, prefiriendo el último (el formato típico es
   "Color / Talla"). Es aproximado a propósito: lo que no cuadra queda como null
   ("Sin talla") en vez de inventar una.
   ============================================================================ */

/* Tallas por palabra (normalizadas en MAYÚSCULAS, sin el prefijo "Talla "). */
const TALLAS_CONOCIDAS = new Set([
  "XS", "S", "M", "L", "XL", "XXL", "XXXL",
  "CH", "CHICA", "CHICO", "MEDIANA", "MEDIANO",
  "G", "GRANDE", "EG", "EXTRA GRANDE", "EXTRAGRANDE", "UNITALLA",
]);

function normaliza(seg: string): string {
  return seg.trim().toUpperCase().replace(/^TALLA\s+/, "").trim();
}

/* Devuelve el token de talla si el segmento parece una (palabra conocida o
   número de 1-3 cifras, p. ej. 28-46); si no, null. */
function comoTalla(seg: string): string | null {
  const s = normaliza(seg);
  if (TALLAS_CONOCIDAS.has(s)) return s;
  if (/^\d{1,3}$/.test(s)) return s;
  return null;
}

/* Talla parseada de una variante libre, o null si no se reconoce. */
export function tallaDeVariante(variante: string | null | undefined): string | null {
  if (!variante) return null;
  const segs = variante.split("/").map((s) => s.trim()).filter(Boolean);
  // De derecha a izquierda: la talla suele ir al final ("Color / Talla").
  for (let i = segs.length - 1; i >= 0; i--) {
    const t = comoTalla(segs[i]);
    if (t) return t;
  }
  return null;
}

/* "Firma de color" de una variante: los segmentos que NO son talla, normalizados
   (minúsculas, sin acentos). Por descarte, porque el texto libre no marca cuál
   segmento es el color. Ej. "Rosa / M" → "rosa"; "Negro / 32" → "negro";
   "Rosa Mexicano / L" → "rosa mexicano". null si no queda nada (solo talla). */
export function colorDeVariante(variante: string | null | undefined): string | null {
  if (!variante) return null;
  const colores = variante
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && comoTalla(s) === null);
  if (colores.length === 0) return null;
  return colores
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* Orden lógico de tallas por palabra (de la más chica a la más grande). */
const ORDEN = [
  "XS", "S", "CH", "CHICA", "CHICO", "M", "MEDIANA", "MEDIANO",
  "L", "G", "GRANDE", "XL", "EG", "EXTRA GRANDE", "EXTRAGRANDE", "XXL", "XXXL", "UNITALLA",
];

/* Compara dos tallas para ordenarlas: números por valor, palabras por el orden
   lógico y el resto alfabético. */
export function compararTallas(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  const ia = ORDEN.indexOf(a.toUpperCase());
  const ib = ORDEN.indexOf(b.toUpperCase());
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b, "es");
}
