/* ============================================================================
   lib/inventario/actor.ts — Quién está detrás de una escritura de stock
   ----------------------------------------------------------------------------
   `registrarStockLog` escribe con el service role (los webhooks y el cron no
   traen sesión), así que no puede deducir el usuario del cliente de Supabase. Y
   quien SÍ lo conoce —la server action— está a tres o cuatro saltos del
   registro: `ajustarStock` → `propagarStock` → `empujar` → logs.

   En vez de arrastrar un `actorId` por todas esas firmas —invasivo, y fácil de
   olvidar en el próximo flujo que se agregue—, se marca una sola vez arriba con
   `conActor` y el registrador lo lee al final con `actorActual`. Es un contexto
   por petición (AsyncLocalStorage): dos usuarios ajustando stock a la vez no se
   pisan, y lo que corre FUERA de un `conActor` —los webhooks de venta, el cron—
   ve `null`, que es exactamente la verdad que queremos guardar.
   ============================================================================ */

import { AsyncLocalStorage } from "node:async_hooks";

const almacen = new AsyncLocalStorage<string | null>();

/* Marca al usuario detrás de todo lo que se ejecute dentro de `fn`. */
export function conActor<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  return almacen.run(userId, fn);
}

/* El usuario del `conActor` que envuelve a quien pregunta, o null si nadie lo
   marcó (cron, webhook). */
export function actorActual(): string | null {
  return almacen.getStore() ?? null;
}
