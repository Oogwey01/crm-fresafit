/* Lo que comparten las familias de acciones de Maquila. Vive aparte y sin
   "use server" porque un módulo de acciones solo puede exportar funciones
   async: una constante o un helper síncrono no caben ahí. */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos-bd";

export function revalidar() {
  revalidatePath("/maquila");
}

/* Cuando el movimiento también movió `products.stock` (mandarle material a
   Eduardo lo saca de bodega): las pantallas que pintan ese número tienen que
   enterarse, o enseñarían un stock que ya no es. */
export function revalidarConStock() {
  revalidatePath("/maquila");
  revalidatePath("/inventario");
  revalidatePath("/bodega");
}

/* Congelar la tarifa de un pedido. Va por RPC y no por un update desde aquí
   porque `maquila_costos` y `maquila_pedido_costos` están cerradas a
   administración: quien corrige el acabado de un pedido —un coordinador— no
   puede leer el precio, pero el costo tiene que quedar igual.

   Si falla, NO tumba la operación que lo llamó: el pedido ya se guardó y lo
   que se pierde es una tarifa que el corte volverá a pedir. Queda en el log
   del servidor para que se vea. */
export async function fijarCosto(
  supabase: SupabaseClient<Database>,
  pedidoId: string,
): Promise<void> {
  const { error } = await supabase.rpc("maquila_fijar_costo_pedido", { pid: pedidoId });
  if (error) console.warn("[maquila] no se pudo congelar el costo:", error.message);
}
