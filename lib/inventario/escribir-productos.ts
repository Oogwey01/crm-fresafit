/* ============================================================================
   lib/inventario/escribir-productos.ts — Aplicar cambios de catálogo en lote
   ----------------------------------------------------------------------------
   Las tres sincronizaciones (Tienda Nube, Mercado Libre, TikTok) terminan igual:
   con una lista de «a esta ficha hay que cambiarle estas columnas». Aplicarla
   con un `update().eq("id", …)` por fila cuesta un viaje a la base por producto;
   agrupados de diez en diez, el catálogo de ~600 fichas son sesenta tandas una
   detrás de otra, y en producción cada tanda se paga completa. PostgREST sabe
   escribir cientos de filas de un golpe con `upsert`, que es justo lo que estos
   archivos ya hacen para `meli_publicaciones` y `tiktok_publicaciones`.

   El detalle que obliga a partir el trabajo: un upsert NO es un update. Postgres
   arma primero la fila que insertaría y le exige sus NOT NULL; solo después
   descubre que el id ya existía y se pasa a actualizar. Un cambio parcial —«a
   esta ficha solo le cambió el tipo de logística»— no trae `products.nombre`,
   que es NOT NULL y sin default, y haría fallar el lote entero. Peor todavía si
   la fila parcial se mezcla con una completa: PostgREST arma un solo INSERT con
   la unión de columnas y las que falten viajarían vacías, o sea que un cambio de
   logística podría borrarle el nombre y el precio a un producto.

   Por eso aquí se separan: los cambios que traen la ficha completa se escriben
   en lote y los parciales siguen fila por fila, exactamente como antes. El
   ahorro se lo lleva el caso masivo —la pasada diaria sobre todo el catálogo—,
   que es el que tardaba; el puñado de correcciones sueltas no se toca porque no
   hay forma segura de agruparlas sin inventar datos.
   ============================================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import { porLotes, TAM_LOTE_UPSERT } from "@/lib/supabase/lotes";

/* Una ficha y las columnas que hay que cambiarle. */
export type CambioProducto = { id: string; fila: Record<string, unknown> };

/* Columnas que `products` exige en cualquier INSERT: NOT NULL y sin default (ver
   20250103000000_inventario.sql y los ALTER posteriores, que sí traen default
   todos). Es la condición para poder mandar una fila por upsert; si una
   migración futura agrega otra columna obligatoria, va aquí — de lo contrario
   los lotes empezarían a fallar. */
const OBLIGATORIAS = ["nombre"] as const;

/* Filas por viaje en el upsert: el tamaño compartido de lib/supabase/lotes. */
const TANDA_UPSERT = TAM_LOTE_UPSERT;

/* Updates sueltos en paralelo. Se conserva el 10 de antes: son pocos y no vale
   la pena empujar más conexiones simultáneas contra la base. */
const TANDA_UPDATE = 10;

/* Aplica la lista de cambios sobre `products`. Lanza al primer error, igual que
   hacían los bucles que reemplaza: una sync a medias es preferible detectarla. */
export async function aplicarCambiosProductos(
  admin: SupabaseClient,
  cambios: CambioProducto[],
): Promise<void> {
  if (cambios.length === 0) return;

  /* Una misma ficha puede aparecer dos veces en la lista (dos publicaciones que
     apuntan al mismo producto). Fila por fila eso eran dos updates seguidos; en
     un upsert Postgres lo rechaza —«ON CONFLICT no puede afectar la misma fila
     dos veces»— y se caería la sync. Se fusionan en el orden en que llegaron,
     que deja el mismo estado final que aplicarlos uno tras otro. */
  const porId = new Map<string, Record<string, unknown>>();
  for (const c of cambios) porId.set(c.id, { ...(porId.get(c.id) ?? {}), ...c.fila });

  /* PostgREST arma UN solo INSERT por lote, así que todas las filas de un lote
     tienen que traer exactamente las mismas columnas: se agrupan por firma. */
  const completos = new Map<string, Record<string, unknown>[]>();
  const parciales: CambioProducto[] = [];
  for (const [id, fila] of porId) {
    if (!OBLIGATORIAS.every((col) => fila[col] != null)) {
      parciales.push({ id, fila });
      continue;
    }
    const firma = Object.keys(fila).sort().join(",");
    completos.set(firma, [...(completos.get(firma) ?? []), { id, ...fila }]);
  }

  /* Cada grupo de firma va en tandas, y las tandas en oleadas paralelas: era un
     bucle anidado estrictamente secuencial (grupos × tandas). */
  for (const grupo of completos.values()) {
    await porLotes(grupo, TANDA_UPSERT, async (tanda) => {
      const { error } = await admin.from("products").upsert(tanda, { onConflict: "id" });
      if (error) throw new Error(error.message);
    });
  }

  for (let i = 0; i < parciales.length; i += TANDA_UPDATE) {
    await Promise.all(
      parciales.slice(i, i + TANDA_UPDATE).map(async ({ id, fila }) => {
        const { error } = await admin.from("products").update(fila).eq("id", id);
        if (error) throw new Error(error.message);
      }),
    );
  }
}
