/* ============================================================================
   lib/supabase/cache.ts — Caché de lecturas casi estáticas
   ----------------------------------------------------------------------------
   El CRM no cacheaba NADA de Supabase: cada navegación volvía a preguntar por
   el equipo, los proveedores y las cuentas de la agencia, que cambian una vez
   al mes. Con Vercel(iad1)→Supabase a ~40 ms eso no es dramático, pero son
   viajes que se pagan en cada carga de casi cada página.

   LA REGLA DE SEGURIDAD, porque es fácil equivocarse aquí:

   Un scope cacheado NO puede leer cookies (lo prohíbe Next), así que por dentro
   usa el cliente admin — que salta RLS. Por eso aquí SOLO puede vivir lo que la
   RLS le daría igual a cualquier persona del equipo interno. Antes de servir
   nada, el helper comprueba el rol FUERA del scope cacheado, con usuarioActual()
   (cacheado por request: no cuesta ningún viaje extra).

   Lo que NO va aquí, y no es un descuido:
   - Cualquier cosa por-usuario (tareas, notificaciones, lecturas).
   - El RPC `metricas_resumen` y compañía: deciden por dentro qué dinero enseñar
     según el rol de quien pregunta. Cachearlos con el cliente admin serviría la
     versión con importes a todo el mundo.

   Cuando se migre a Cache Components ('use cache' + cacheTag), el cambio es de
   este archivo únicamente; leer antes
   node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md.
   ============================================================================ */

import { revalidateTag, unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/* Las etiquetas con las que se tira el caché. Una por tabla; las actions que
   escriben llaman a `invalidar(...)` con la suya. */
export const TAGS = {
  equipo: "equipo",
  proveedores: "proveedores",
  agencia: "agencia",
} as const;

export type Tag = (typeof TAGS)[keyof typeof TAGS];

/* Una hora. Estas tablas cambian por acción de alguien —dar de alta a una
   persona, un proveedor, un cliente—, y esas acciones ya invalidan su etiqueta:
   el tiempo es solo la red de seguridad para lo que se edite por fuera del CRM
   (el panel de Supabase, una migración). */
const UNA_HORA = 3600;

/* Envuelve una consulta en el caché de Next. `nombre` entra en la llave, así
   que dos consultas distintas nunca se pisan. */
export function consultaCacheada<T>(
  nombre: string,
  tags: Tag[],
  consulta: (admin: SupabaseClient) => Promise<T>,
  revalidate: number = UNA_HORA,
): () => Promise<T> {
  return unstable_cache(async () => consulta(createAdminClient()), [nombre], { tags, revalidate });
}

/* Tira el caché de una etiqueta. La llaman las actions que escriben en esas
   tablas, junto a su revalidatePath de siempre.

   `"max"` es stale-while-revalidate: quien entre justo después del cambio
   puede ver la versión anterior un instante mientras se refresca por detrás.
   Es aceptable porque aquí solo viven nombres, colores y listas de selección
   — los PERMISOS salen de usuarioActual(), que no pasa por este caché—. La
   firma de un solo argumento quedó deprecada en Next 16. */
export function invalidar(tag: Tag): void {
  revalidateTag(tag, "max");
}
