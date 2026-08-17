/* ============================================================================
   lib/pedidos/produccion.ts — Qué pedidos hay que FABRICAR antes de empacarlos
   ----------------------------------------------------------------------------
   Un cinturón personalizado no se saca de un estante: lo produce Eduardo —se
   sublima o se borda— y hasta que no está hecho no hay nada que empacar. En la
   bandeja de bodega salía mezclado con el resto, así que la lista de "lo que
   hay que armar hoy" incluía 46 piezas que ni siquiera existían todavía.

   `maquila_pedidos.sale_id` es la liga exacta y es la que se usa aquí: la deja
   la ingesta de maquila al dar de alta el renglón (lib/maquila/ingesta.ts), con
   la misma clave (canal, referencia_externa) que la venta. Se prefiere a mirar
   si el producto tiene ficha en `maquila_productos` porque esto último se queda
   corto —medido el 17/08/2026: 22 renglones contra los 46 reales—; la ficha
   puede haber cambiado o el producto reconocerse por otra publicación, pero el
   pedido de producción, si existe, es un hecho.
   ============================================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import { traerPorLotes } from "@/lib/supabase/lotes";
import type { Database } from "@/lib/supabase/tipos-bd";
import type { EstadoMaquilaId } from "@/lib/types";

/* En qué va la producción de cada venta. La llave es `sales.id`. */
export type EnProduccion = Record<string, EstadoMaquilaId>;

/* Los estados de los que ya no depende empacar: la pieza salió del taller (o
   nunca va a salir). Un renglón así vuelve a ser un pedido normal de bodega. */
const YA_NO_ESTA_EN_EL_TALLER: readonly string[] = ["enviado", "entregado", "cancelado", "devuelto"];

export async function leerEnProduccion(
  supabase: SupabaseClient<Database>,
  ventaIds: string[],
): Promise<EnProduccion> {
  if (ventaIds.length === 0) return {};

  /* Por lotes: el `.in()` viaja en la URL y aquí van los cientos de pedidos que
     carga la pantalla. */
  const filas = await traerPorLotes<string, { sale_id: string | null; estado: string }>(
    ventaIds,
    (lote) => supabase.from("maquila_pedidos").select("sale_id, estado").in("sale_id", lote),
  );

  const mapa: EnProduccion = {};
  for (const f of filas) {
    if (!f.sale_id || YA_NO_ESTA_EN_EL_TALLER.includes(f.estado)) continue;
    mapa[f.sale_id] = f.estado as EstadoMaquilaId;
  }
  return mapa;
}
