/* ============================================================================
   lib/personalizados/correo-cliente.ts — A qué dirección se le escribe
   ----------------------------------------------------------------------------
   La ficha de un personalizado guarda el nombre del cliente, no su correo: ese
   vive en `customers`, colgado de la venta. Esto hace el puente ficha → venta →
   cliente → correo, y decide cuándo NO hay a quién escribirle.

   POR QUÉ NO TODOS TIENEN CORREO. Solo Tienda Nube entrega el correo real del
   comprador. Mercado Libre lo anonimiza y el CRM ni lo guarda a propósito
   (lib/mercadolibre/ventas.ts), y TikTok manda uno enmascarado @scs.tiktok.com
   que rebota (lib/tiktok/ventas.ts). Así que «solo a quien tenemos correo» no es
   una salvedad del código: es la realidad de los canales.

   LA REGLA QUE MANDA AQUÍ: ante la duda, nadie. Este mapa alimenta un correo que
   sale hacia afuera, y escribirle al cliente equivocado no se puede deshacer —ni
   explicar—. Por eso el respaldo por folio (para las fichas que no quedaron
   ligadas a su venta) se descarta en cuanto el mismo número aparece en dos
   órdenes: prefiere no encontrar a adivinar.
   ============================================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos-bd";
import { traerPorLotes } from "@/lib/supabase/lotes";

type Cliente = SupabaseClient<Database>;

/* Lo que hace falta de una ficha para encontrar a su cliente. */
export type FichaConVenta = {
  id: string;
  sale_order_id: string | null;
  no_venta: string | null;
};

type FilaOrden = { id: string; numero: string | null; cliente_id: string | null };

/* id de la ficha → correo del cliente. Solo entran las que tienen uno usable;
   el resto simplemente no aparece, que es como la UI sabe a quién puede
   escribirle. */
export async function correosDeClientes(
  supabase: Cliente,
  fichas: FichaConVenta[],
): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  if (!fichas.length) return salida;

  /* --- 1. Las órdenes: por liga directa y, si no hay, por folio ------------- */
  const ligadas = [...new Set(fichas.map((f) => f.sale_order_id).filter((v): v is string => !!v))];
  const folios = [
    ...new Set(
      fichas
        .filter((f) => !f.sale_order_id)
        .map((f) => f.no_venta?.trim())
        .filter((v): v is string => !!v),
    ),
  ];

  const columnas = "id, numero, cliente_id";
  const [porId, porFolio] = await Promise.all([
    ligadas.length
      ? traerPorLotes<string, FilaOrden>(ligadas, (lote) =>
          supabase.from("sale_orders").select(columnas).in("id", lote),
        )
      : Promise.resolve([]),
    folios.length
      ? traerPorLotes<string, FilaOrden>(folios, (lote) =>
          supabase.from("sale_orders").select(columnas).in("numero", lote),
        )
      : Promise.resolve([]),
  ]);

  const clientePorOrden = new Map(porId.map((o) => [o.id, o.cliente_id]));

  /* El folio solo vale si es inequívoco: dos órdenes con el mismo número (dos
     canales, un folio reciclado) dejan a esa ficha sin correo, a propósito. */
  const clientePorFolio = new Map<string, string | null>();
  const foliosAmbiguos = new Set<string>();
  for (const o of porFolio) {
    if (!o.numero) continue;
    if (clientePorFolio.has(o.numero)) foliosAmbiguos.add(o.numero);
    else clientePorFolio.set(o.numero, o.cliente_id);
  }
  for (const f of foliosAmbiguos) clientePorFolio.delete(f);

  /* --- 2. El correo de esos clientes --------------------------------------- */
  const clientePorFicha = new Map<string, string>();
  for (const f of fichas) {
    const cid = f.sale_order_id
      ? clientePorOrden.get(f.sale_order_id)
      : clientePorFolio.get(f.no_venta?.trim() ?? "");
    if (cid) clientePorFicha.set(f.id, cid);
  }

  const ids = [...new Set(clientePorFicha.values())];
  if (!ids.length) return salida;

  const clientes = await traerPorLotes<string, { id: string; correo: string | null }>(
    ids,
    (lote) => supabase.from("customers").select("id, correo").in("id", lote),
  );

  /* Los enmascarados de TikTok están guardados en otra columna, pero si alguno
     se coló alguna vez por `correo` no se le escribe: rebota y ensucia la
     reputación del dominio. */
  const correoPorCliente = new Map<string, string>();
  for (const c of clientes) {
    const correo = c.correo?.trim().toLowerCase();
    if (correo && correo.includes("@") && !correo.endsWith("@scs.tiktok.com")) {
      correoPorCliente.set(c.id, correo);
    }
  }

  for (const [fichaId, clienteId] of clientePorFicha) {
    const correo = correoPorCliente.get(clienteId);
    if (correo) salida.set(fichaId, correo);
  }
  return salida;
}
