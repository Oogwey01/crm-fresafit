/* Lo que comparten las familias de acciones de Maquila. Vive aparte y sin
   "use server" porque un módulo de acciones solo puede exportar funciones
   async: una constante o un helper síncrono no caben ahí. */

import { revalidatePath } from "next/cache";

export function revalidar() {
  revalidatePath("/maquila");
}
