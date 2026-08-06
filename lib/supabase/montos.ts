import type { usuarioActual } from "@/lib/supabase/usuario-actual";
import { TAM_LOTE_IN } from "@/lib/supabase/lotes";

/* ============================================================================
   lib/supabase/montos.ts — Los importes, por la puerta que valida
   ----------------------------------------------------------------------------
   `sales.monto` y `products.costo` están fuera del alcance del token del
   navegador: la migración 20260902000000 revocó el SELECT de esas dos columnas
   a `authenticated` y las expuso por sendas vistas `security definer` que
   preguntan por el rol —`ventas_montos` y `producto_costos`—.

   El listado se sigue pidiendo a la tabla, con sus embeds y su paginación
   intactos, y el importe se une aquí por `id`. La alternativa era mover el
   listado entero a una función de Postgres, lo que habría obligado a rehacer la
   tabla de ventas de Métricas —paginación, orden y join al producto— por una
   columna.

   Cuando `pedir` es false ni se hace el viaje: no es que el importe llegue y se
   descarte, es que no se pregunta.
   ============================================================================ */

/* El mismo cliente que reparte `usuarioActual`, derivado de ahí para no tener
   que repetir sus parámetros de tipo (que cambian con la versión de supabase-js). */
type Cliente = Awaited<ReturnType<typeof usuarioActual>>["supabase"];

/* El `.in()` se trocea en lotes que quepan en la URL (ver lib/supabase/lotes)
   y se piden en paralelo: mismo tiempo de pared que un viaje. Pedir la vista
   sin filtro tampoco serviría: PostgREST corta en 1.000 filas sin avisar. */

async function unir<T extends { id: string }, C extends string>(
  supabase: Cliente,
  filas: T[],
  pedir: boolean,
  vista: string,
  campo: C,
): Promise<(T & { [K in C]?: number | null })[]> {
  if (!pedir || filas.length === 0) return filas as (T & { [K in C]?: number | null })[];

  const ids = filas.map((f) => f.id);
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += TAM_LOTE_IN) lotes.push(ids.slice(i, i + TAM_LOTE_IN));

  const resultados = await Promise.all(
    lotes.map((lote) => supabase.from(vista).select(`id, ${campo}`).in("id", lote)),
  );
  const error = resultados.find((r) => r.error)?.error ?? null;
  const data = error ? null : resultados.flatMap((r) => r.data ?? []);

  /* Si la vista falla —lo más probable, que la migración aún no se haya
     pegado— se devuelven las filas sin importe. Degradar a «—» es preferible a
     tumbar la pantalla, y el aviso queda en el log del servidor. */
  if (error) {
    console.warn(`[dinero] ${vista} no disponible:`, error.message);
    return filas as (T & { [K in C]?: number | null })[];
  }

  const porId = new Map(
    (data ?? []).map((f) => [
      (f as Record<string, unknown>).id as string,
      (f as Record<string, unknown>)[campo] as number | null,
    ]),
  );
  return filas.map((f) => ({ ...f, [campo]: porId.get(f.id) ?? null })) as (T & {
    [K in C]?: number | null;
  })[];
}

/* Le pone `monto` a cada venta. El permiso se resuelve dentro de la vista, y es
   POR CANAL: el encargado de una plataforma recibe los suyos y null en el resto. */
export async function adjuntarMontos<T extends { id: string }>(
  supabase: Cliente,
  ventas: T[],
  pedir: boolean,
): Promise<(T & { monto?: number | null })[]> {
  return unir(supabase, ventas, pedir, "ventas_montos", "monto");
}

/* Le pone `costo` a cada ficha del catálogo (ámbito de egresos). */
export async function adjuntarCostos<T extends { id: string }>(
  supabase: Cliente,
  productos: T[],
  pedir: boolean,
): Promise<(T & { costo?: number | null })[]> {
  return unir(supabase, productos, pedir, "producto_costos", "costo");
}
