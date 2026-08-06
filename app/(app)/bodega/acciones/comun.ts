/* Lo que comparten las cinco familias de acciones de Bodega. Vive aparte y sin
   "use server" porque un módulo de acciones solo puede exportar funciones
   async: una constante o un helper síncrono no caben ahí. */

import { revalidatePath } from "next/cache";

/* Bodega y el catálogo se revalidan juntos: descontar una carga o mover un
   insumo cambia el stock que pinta /inventario. */
const RUTAS = ["/bodega", "/inventario"];

export function revalidar() {
  for (const r of RUTAS) revalidatePath(r);
}
