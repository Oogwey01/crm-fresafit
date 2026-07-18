/* ============================================================================
   lib/inventario/stock-hub.ts — Propagación de stock multicanal
   ----------------------------------------------------------------------------
   El CRM es el hub del stock unificado: un cambio que entra por un canal
   (o por el propio CRM) se reenvía a los demás canales vinculados. La regla
   anti-bucle NO vive aquí: el LLAMADOR solo propaga cuando el valor nuevo
   difiere del que ya estaba en la base (no-op corta el eco de vuelta).

   Vive en un módulo propio para que tiendanube/sync y mercadolibre/sync no
   se importen entre sí (solo importan los clientes API).
   ============================================================================ */

import { actualizarVarianteTN, conexionTiendanube } from "@/lib/tiendanube/api";
import { actualizarStockML, conexionMercadolibre } from "@/lib/mercadolibre/api";
import { registrarStockLog, type EntradaStockLog } from "@/lib/inventario/stock-log";

export type OrigenStock = "crm" | "tiendanube" | "mercadolibre" | "tiktok";

/* Etiqueta de `origen` para el ledger según el canal que disparó el empuje. */
const ORIGEN_LOG: Record<OrigenStock, string> = {
  crm: "manual",
  tiendanube: "tiendanube_sync",
  mercadolibre: "mercadolibre_sync",
  tiktok: "tiktok_sync",
};

export type FilaVinculada = {
  id?: string | null; // id del producto en el CRM (para el ledger)
  tiendanube_product_id: number | null;
  tiendanube_variant_id: number | null;
  meli_item_id: string | null;
  meli_variation_id: number | null;
  // TikTok (fase 2): el hub ya acepta estos campos; el empuje a TikTok aún no
  // se implementa (falta actualizarStockTikTok en lib/tiktok/api.ts).
  tiktok_product_id?: string | null;
  tiktok_sku_id?: string | null;
  stock: number;
};

/* Empuja el stock de cada fila a los canales vinculados distintos del origen.
   No lanza: devuelve la lista de errores por canal para que el llamador
   decida (mostrarlos al usuario o solo loggearlos). Canal sin conexión
   guardada → se salta en silencio. */
export async function propagarStock(origen: OrigenStock, filas: FilaVinculada[]): Promise<string[]> {
  const errores: string[] = [];
  const logs: EntradaStockLog[] = []; // una entrada por empuje saliente que sí se aplicó

  const aTN =
    origen === "tiendanube"
      ? []
      : filas.filter((f) => f.tiendanube_product_id != null && f.tiendanube_variant_id != null);
  const aML = origen === "mercadolibre" ? [] : filas.filter((f) => f.meli_item_id != null);

  if (aTN.length > 0) {
    try {
      const cx = await conexionTiendanube();
      if (cx) {
        for (const f of aTN) {
          try {
            await actualizarVarianteTN(cx, f.tiendanube_product_id!, f.tiendanube_variant_id!, {
              stock: f.stock,
            });
            logs.push({
              producto_id: f.id ?? null,
              canal: "tienda_nube",
              origen: ORIGEN_LOG[origen],
              stock_anterior: null,
              stock_nuevo: f.stock,
            });
          } catch (e) {
            errores.push(`Tienda Nube: ${mensaje(e)}`);
          }
        }
      }
    } catch (e) {
      errores.push(`Tienda Nube: ${mensaje(e)}`);
    }
  }

  if (aML.length > 0) {
    try {
      const cx = await conexionMercadolibre();
      if (cx) {
        for (const f of aML) {
          try {
            await actualizarStockML(cx, f.meli_item_id!, f.meli_variation_id, f.stock);
            logs.push({
              producto_id: f.id ?? null,
              canal: "mercado_libre",
              origen: ORIGEN_LOG[origen],
              stock_anterior: null,
              stock_nuevo: f.stock,
            });
          } catch (e) {
            errores.push(`Mercado Libre: ${mensaje(e)}`);
          }
        }
      }
    } catch (e) {
      errores.push(`Mercado Libre: ${mensaje(e)}`);
    }
  }

  await registrarStockLog(logs);
  return errores;
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : "error desconocido";
}
