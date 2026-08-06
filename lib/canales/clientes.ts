/* Upsert compartido de clientes de canal. Los tres importadores de ventas
   hacían exactamente lo mismo con nombres distintos: upsert por lotes sobre
   `customers` con su columna de identidad (correo para Tienda Nube,
   mercadolibre_buyer_id, tiktok_buyer_id) y relectura por `.in()` para armar
   el mapa clave → id que las ventas necesitan. Solo cambiaba la columna.

   `notas` no viaja nunca en el payload a propósito: es del equipo, y el upsert
   solo refresca lo que el canal sabe del comprador. */

import { createAdminClient } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/lib/supabase/tipos-bd";
import { TAM_LOTE_IN, TAM_LOTE_UPSERT } from "@/lib/supabase/lotes";

type ColumnaClienteCanal = "correo" | "mercadolibre_buyer_id" | "tiktok_buyer_id";

/* Crea/actualiza los clientes y devuelve el mapa clave → id del CRM. Lanza al
   primer error; el caller decide si la sync de clientes es fatal o no (los
   tres importadores la tratan como no-fatal: la venta se registra igual). */
export async function upsertClientesPorClave<K extends string | number>(
  columnaConflicto: ColumnaClienteCanal,
  filas: TablesInsert<"customers">[],
): Promise<Map<K, string>> {
  if (filas.length === 0) return new Map();
  const admin = createAdminClient();

  /* En tandas: reimportar el histórico son cientos de compradores de una
     sentada, y tanto el INSERT gigante como el `.in()` con todas las claves
     (URL de 40 KB → 400) se caen. Ver lib/supabase/lotes.ts. */
  for (let i = 0; i < filas.length; i += TAM_LOTE_UPSERT) {
    const { error } = await admin
      .from("customers")
      .upsert(filas.slice(i, i + TAM_LOTE_UPSERT), { onConflict: columnaConflicto });
    if (error) throw new Error(error.message);
  }

  const claves = filas.map((f) => f[columnaConflicto] as K);
  const mapa = new Map<K, string>();
  for (let i = 0; i < claves.length; i += TAM_LOTE_IN) {
    const { data, error } = await admin
      .from("customers")
      .select(`id, ${columnaConflicto}`)
      .in(columnaConflicto, claves.slice(i, i + TAM_LOTE_IN));
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as Record<string, unknown>[]) {
      mapa.set(c[columnaConflicto] as K, c.id as string);
    }
  }
  return mapa;
}
