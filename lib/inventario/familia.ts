/* ============================================================================
   lib/inventario/familia.ts — Agrupar las variantes de un mismo producto
   ----------------------------------------------------------------------------
   `products` es plano: una fila por variante de canal, sin `producto_padre_id`.
   Por eso un cinturón con cuatro tallas se ve como cuatro renglones sueltos, que
   es justo lo que pidió arreglar Armando ("que si le pico a ese cinturón se
   desglosen todas las tallas y el inventario actual").

   Aquí se reconstruye la FAMILIA (el producto real) a partir de lo único que la
   relaciona de verdad: el nombre. Ojo con la tentación de agrupar por SKU — cada
   talla tiene el suyo, así que el agrupado por SKU de reabastecimiento.ts junta
   la misma talla publicada en VARIOS canales, no las tallas entre sí.

   La talla se saca de `products.variante` con lib/talla.ts, que ya resuelve el
   parseo y el orden.
   ============================================================================ */

import { compararTallas, tallaDeVariante } from "@/lib/talla";

/* Lo mínimo que necesita la agrupación; cualquier producto lo cumple. */
type ProductoAgrupable = {
  id: string;
  nombre: string;
  variante: string | null;
  stock: number;
  precio: number | null;
};

/* Normaliza para comparar: sin acentos, sin dobles espacios, en minúsculas. */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* Algunos títulos ya traen la talla pegada al nombre ("Cinturón Akatsuki - M",
   "Cinturón Akatsuki Talla G"). Si se dejara, cada talla formaría su propia
   familia y no habríamos agrupado nada. */
const COLA_TALLA =
  /[\s\-–—,]+(?:talla\s+)?(?:xs|s|m|l|g|xl|xxl|xxxl|ch|chica|chico|mediana|mediano|grande|eg|extra\s?grande|unitalla|\d{1,3})$/i;

export function nombreBase(nombre: string): string {
  let n = nombre.trim();
  /* Dos pasadas: "Cinturón Akatsuki - Talla M" deja cola dos veces en algunos
     títulos ("… - M - 32"). Más de dos sería comerse el nombre. */
  for (let i = 0; i < 2; i++) {
    const corto = n.replace(COLA_TALLA, "").trim();
    if (corto === n || corto.length < 3) break;
    n = corto;
  }
  return n;
}

/* Clave con la que dos renglones son "el mismo producto". */
export function claveFamilia(p: Pick<ProductoAgrupable, "nombre">): string {
  return normalizar(nombreBase(p.nombre));
}

export type Familia<T extends ProductoAgrupable> = {
  clave: string;
  /* Nombre a mostrar: el más corto del grupo, que suele ser el limpio (los
     títulos de Mercado Libre arrastran cola de palabras clave). */
  nombre: string;
  variantes: T[]; // ordenadas por talla
  stock: number; // suma del grupo
  precioMin: number | null;
  precioMax: number | null;
  /* Tallas reconocidas, ya ordenadas (XS < S < M < L…). Vacío si el producto
     no maneja tallas: entonces el grupo es un producto suelto. */
  tallas: string[];
};

/* Agrupa un catálogo en familias. Preserva el orden alfabético por nombre para
   que la lista se lea igual que la desglosada. */
export function agruparEnFamilias<T extends ProductoAgrupable>(productos: T[]): Familia<T>[] {
  const grupos = new Map<string, T[]>();
  for (const p of productos) {
    const clave = claveFamilia(p);
    grupos.set(clave, [...(grupos.get(clave) ?? []), p]);
  }

  return [...grupos.entries()]
    .map(([clave, variantes]) => {
      const ordenadas = [...variantes].sort((a, b) => {
        const ta = tallaDeVariante(a.variante);
        const tb = tallaDeVariante(b.variante);
        if (ta && tb) return compararTallas(ta, tb);
        if (ta) return -1;
        if (tb) return 1;
        return (a.variante ?? "").localeCompare(b.variante ?? "", "es", { numeric: true });
      });
      const precios = ordenadas.map((p) => p.precio).filter((n): n is number => n != null && n > 0);
      const tallas = [
        ...new Set(
          ordenadas
            .map((p) => tallaDeVariante(p.variante))
            .filter((t): t is string => t !== null),
        ),
      ].sort(compararTallas);
      return {
        clave,
        nombre: ordenadas.reduce((a, b) => (b.nombre.length < a.nombre.length ? b : a)).nombre,
        variantes: ordenadas,
        stock: ordenadas.reduce((a, p) => a + (p.stock ?? 0), 0),
        precioMin: precios.length > 0 ? Math.min(...precios) : null,
        precioMax: precios.length > 0 ? Math.max(...precios) : null,
        tallas,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}

/* Las demás variantes del mismo producto (para el detalle de una ficha: al abrir
   un cinturón hay que ver TODAS sus tallas con su stock, no solo la clicada). */
export function variantesHermanas<T extends ProductoAgrupable>(producto: T, catalogo: T[]): T[] {
  const clave = claveFamilia(producto);
  return catalogo
    .filter((p) => claveFamilia(p) === clave)
    .sort((a, b) => {
      const ta = tallaDeVariante(a.variante);
      const tb = tallaDeVariante(b.variante);
      if (ta && tb) return compararTallas(ta, tb);
      return (a.variante ?? "").localeCompare(b.variante ?? "", "es", { numeric: true });
    });
}
