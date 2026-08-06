/* Paginación de PostgREST: Supabase corta las respuestas en ~1000 filas
   (max-rows) SIN error, así que un select "sin límite" sobre una tabla que
   crece puede devolver un resultado incompleto en silencio. Este helper
   generaliza el bucle de range() que mercadolibre/ventas.ts ya usaba. */

/* Cuántas tandas van juntas cuando hace falta más de una. Tres cubre de sobra
   los volúmenes de hoy (clientes ≈ 2.5 tandas, catálogo ≈ 1.2) y las de más
   vienen vacías: costo cero de pared, porque viajan en paralelo. */
const TANDAS_POR_OLEADA = 3;

/* Trae TODAS las filas paginando en tandas de `tam`. El caller construye la
   query (con sus filtros) en cada tanda, porque los builders de supabase-js
   no son reutilizables entre llamadas:
     const filas = await traerTodo<Fila>((desde, hasta) =>
       admin.from("products").select("...").range(desde, hasta));

   La primera tanda viaja sola —casi siempre es la única—; si viene llena, las
   siguientes salen en OLEADAS en paralelo hasta que alguna venga corta. Antes
   eran estrictamente secuenciales: el catálogo (2 tandas) y los clientes (3)
   pagaban cada tanda como un viaje completo más. */
/* `data` se recibe como `unknown` y el caller declara la forma con <T>. Es a
   propósito: los builders de supabase-js infieren la fila del esquema, pero los
   selects con embeds o con la lista de columnas armada al vuelo se rinden y
   devuelven otra cosa. Con la firma estricta, cada llamada tenía que escribir
   un `as unknown as PromiseLike<…>` de cinco renglones; el cast vive aquí una
   vez, y el tipo que importa —el de las filas que salen— lo sigue poniendo
   quien llama. */
export async function traerTodo<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>,
  tam = 1000,
): Promise<T[]> {
  const filasDe = (r: { data: unknown }): T[] => (r.data ?? []) as T[];

  const primera = await consulta(0, tam - 1);
  if (primera.error) throw new Error(primera.error.message);
  const filas: T[] = [...filasDe(primera)];
  if (filasDe(primera).length < tam) return filas;

  for (let base = tam; ; base += tam * TANDAS_POR_OLEADA) {
    const tandas = await Promise.all(
      Array.from({ length: TANDAS_POR_OLEADA }, (_, i) =>
        consulta(base + i * tam, base + (i + 1) * tam - 1),
      ),
    );
    for (const tanda of tandas) {
      if (tanda.error) throw new Error(tanda.error.message);
      filas.push(...filasDe(tanda));
      /* Tanda corta = se acabaron las filas; las que la siguen en la oleada
         vienen vacías por definición del mismo orden. */
      if (filasDe(tanda).length < tam) return filas;
    }
  }
}
