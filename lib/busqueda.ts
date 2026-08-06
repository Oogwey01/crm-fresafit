/* ============================================================================
   lib/busqueda.ts — El criterio de búsqueda de las listas del CRM.
   ----------------------------------------------------------------------------
   Un solo comparador para todos los buscadores: sin acentos, sin mayúsculas y
   por palabras sueltas, de modo que «berserk eg» encuentre «Berserk Manga ·
   talla EG» aunque en la ficha esos dos datos vivan en columnas distintas. Los
   campos se juntan en un solo texto y cada palabra tecleada tiene que estar en
   alguna parte de él.
   ============================================================================ */

import { norm } from "@/lib/importar/tsv";

/* Los términos ya normalizados. Se calcula una vez por render y se reusa en
   cada fila: normalizar la búsqueda dentro del filtro la repetía por renglón. */
export function terminosBusqueda(busqueda: string): string[] {
  return norm(busqueda).split(/\s+/).filter(Boolean);
}

/* ¿Esta fila coincide? Sin términos (campo vacío) siempre sí: un buscador en
   blanco no esconde nada. */
export function coincide(
  terminos: string[],
  ...campos: (string | number | null | undefined)[]
): boolean {
  if (!terminos.length) return true;
  const texto = norm(campos.filter((c) => c !== null && c !== undefined).join(" "));
  return terminos.every((t) => texto.includes(t));
}
