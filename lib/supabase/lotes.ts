/* Tamaños de lote para hablar con PostgREST. Son dos límites distintos:

   - Un `.in(...)` viaja en la URL (los selects son GET). Con el catálogo
     entero —1.100+ UUIDs— la URL pasa de 40 KB y el edge de Supabase contesta
     un 400 pelón antes de llegar a la base. TAM_LOTE_IN cabe siempre.
   - Los upserts viajan en el body, sin ese techo, pero PostgREST arma UNA
     sentencia por petición: un lote gigante la hace lenta y el reintento caro.
     TAM_LOTE_UPSERT es el tamaño que los importadores de ventas llevan años
     usando sin sustos.

   Antes cada módulo llevaba su propio número (150, 200, 300…) para el mismo
   límite; los que se pasaban eran 400s latentes que solo aparecerían al crecer
   el catálogo. El LOTE=40 de lib/storage.ts no es de PostgREST sino de la API
   de Storage (createSignedUrls): ese vive allá a propósito. */

export const TAM_LOTE_IN = 150;
export const TAM_LOTE_UPSERT = 200;

/* Cuántos lotes viajan a la vez. Los bucles que esto sustituye eran
   estrictamente secuenciales —cada tanda pagaba su viaje completo—, y un
   Promise.all sin tope abriría cien conexiones contra la base de golpe.
   Cuatro es el mismo criterio de oleadas que usa traerTodo. */
const LOTES_EN_PARALELO = 4;

/* Trocea `lista` en lotes de `tam` y corre `tarea` sobre cada uno, en oleadas
   paralelas. Devuelve los resultados en el orden de la lista. */
export async function porLotes<T, R>(
  lista: T[],
  tam: number,
  tarea: (lote: T[]) => Promise<R>,
): Promise<R[]> {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tam) lotes.push(lista.slice(i, i + tam));

  const resultados: R[] = [];
  for (let i = 0; i < lotes.length; i += LOTES_EN_PARALELO) {
    resultados.push(...(await Promise.all(lotes.slice(i, i + LOTES_EN_PARALELO).map(tarea))));
  }
  return resultados;
}

/* Lectura por `.in()` troceada: el caso más común de porLotes. El caller arma
   la consulta con el lote de claves; los builders de supabase-js no son
   reutilizables entre llamadas, por eso recibe una función.

   `data` llega como `unknown` y la forma la declara quien llama con <F>, por el
   mismo motivo que en `traerTodo`: los selects con embeds o con las columnas
   armadas al vuelo no los infiere supabase-js. */
export async function traerPorLotes<K, F>(
  claves: K[],
  consulta: (lote: K[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<F[]> {
  const tandas = await porLotes(claves, TAM_LOTE_IN, async (lote) => {
    const { data, error } = await consulta(lote);
    if (error) throw new Error(error.message);
    return (data ?? []) as F[];
  });
  return tandas.flat();
}
