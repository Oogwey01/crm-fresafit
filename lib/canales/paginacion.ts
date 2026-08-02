/* Paginación de PostgREST: Supabase corta las respuestas en ~1000 filas
   (max-rows) SIN error, así que un select "sin límite" sobre una tabla que
   crece puede devolver un resultado incompleto en silencio. Este helper
   generaliza el bucle de range() que mercadolibre/ventas.ts ya usaba. */

/* Trae TODAS las filas paginando en tandas de `tam`. El caller construye la
   query (con sus filtros) en cada tanda, porque los builders de supabase-js
   no son reutilizables entre llamadas:
     const filas = await traerTodo<Fila>((desde, hasta) =>
       admin.from("products").select("...").range(desde, hasta));       */
export async function traerTodo<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
  tam = 1000,
): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += tam) {
    const { data, error } = await consulta(desde, desde + tam - 1);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if ((data ?? []).length < tam) break;
  }
  return filas;
}
