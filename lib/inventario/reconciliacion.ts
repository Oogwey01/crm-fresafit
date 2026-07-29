/* ============================================================================
   lib/inventario/reconciliacion.ts — Reporte de descuadres de inventario
   ----------------------------------------------------------------------------
   Lee el stock EN VIVO de cada canal (Tienda Nube y Mercado Libre) y lo compara
   contra el del CRM, para listar solo los productos que NO coinciden. Sirve para
   encontrar los artículos que quedaron descuadrados por escrituras automáticas
   viejas (cuando ML llegaba a pisar el stock de TN).

   Es SOLO LECTURA: no escribe nada en ningún lado ni corrige. La corrección se
   hace a mano con el ajuste +/− de la tabla, que es la vía autorizada.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import { conexionTiendanube, listarProductosTN, type ProductoTN } from "@/lib/tiendanube/api";
import { conexionMercadolibre, listarItemsML, type ItemML } from "@/lib/mercadolibre/api";
import { clave, unidadesDe } from "@/lib/mercadolibre/sync";
import {
  detectarDuplicadosML,
  detectarDuplicadosPorSku,
  type GrupoDuplicado,
} from "@/lib/inventario/duplicados-ml";
import { esFull } from "@/lib/inventario/reabastecimiento";
import type { TipoProductoId } from "@/lib/types";

export type Descuadre = {
  id: string;
  nombre: string;
  variante: string | null;
  sku: string | null;
  tipo: TipoProductoId;
  /* Combo/bundle/personalizado: variante sin control de inventario en Tienda
     Nube, o producto "bajo pedido". No lleva un número de stock comparable. */
  es_combo: boolean;
  stock_crm: number;
  /* null = el producto no está vinculado a ese canal. */
  stock_tn: number | null;
  stock_ml: number | null;
  /* Vinculado al canal pero la publicación ya no apareció en su catálogo
     (borrada, pausada o fuera de la cuenta conectada). */
  falta_en_tn: boolean;
  falta_en_ml: boolean;
};

export type FilaCRM = {
  id: string;
  nombre: string;
  variante: string | null;
  sku: string | null;
  tipo: TipoProductoId;
  bajo_pedido: boolean;
  stock: number;
  tiendanube_variant_id: number | null;
  meli_item_id: string | null;
  meli_variation_id: number | null;
  meli_logistic_type: string | null;
};

/* Catálogo del CRM + stock EN VIVO de los canales, leído una sola vez.
   Lo comparten el reporte de descuadres y la foto horaria (lib/inventario/
   foto-canales.ts) para que ambos midan con exactamente la misma vara. */
export type LecturaCanales = {
  filas: FilaCRM[];
  productosTN: ProductoTN[] | null; // null = canal no conectado
  itemsML: ItemML[] | null;
  stockTN: Map<number, number>;
  /* Variantes de TN con `stock: null` = "sin control de inventario" (combos,
     bundles, personalizados). Existen en el canal, pero no tienen número. */
  sinControlTN: Set<number>;
  stockML: Map<string, number>;
};

export async function leerCanales(): Promise<LecturaCanales> {
  const admin = createAdminClient();

  const [cxTN, cxML] = await Promise.all([conexionTiendanube(), conexionMercadolibre()]);
  if (!cxTN && !cxML) {
    throw new Error("No hay ningún canal conectado con el cual comparar.");
  }

  // Catálogo del CRM: solo productos activos y vinculados a algún canal.
  const { data, error } = await admin
    .from("products")
    .select(
      "id, nombre, variante, sku, tipo, bajo_pedido, stock, tiendanube_variant_id, meli_item_id, meli_variation_id, meli_logistic_type",
    )
    .eq("activo", true)
    .or("tiendanube_variant_id.not.is.null,meli_item_id.not.is.null")
    .order("nombre");
  if (error) throw new Error(error.message);

  // Stock en vivo de cada canal (en paralelo; cada uno pagina su catálogo).
  const [productosTN, itemsML] = await Promise.all([
    cxTN ? listarProductosTN(cxTN) : Promise.resolve(null),
    cxML ? listarItemsML(cxML) : Promise.resolve(null),
  ]);

  const stockTN = new Map<number, number>();
  const sinControlTN = new Set<number>();
  for (const p of productosTN ?? []) {
    for (const v of p.variants) {
      if (typeof v.stock === "number") stockTN.set(v.id, Math.max(0, v.stock));
      else sinControlTN.add(v.id);
    }
  }

  // Mercado Libre: unidad (item + variación) → stock.
  const stockML = new Map<string, number>();
  for (const item of itemsML ?? []) {
    for (const u of unidadesDe(item)) stockML.set(clave(u.itemId, u.variationId), u.stock);
  }

  return { filas: (data ?? []) as FilaCRM[], productosTN, itemsML, stockTN, sinControlTN, stockML };
}

/* Qué dice cada canal del stock de una fila, con las tres exclusiones que el
   caso real dejó claras:
     · Mercado Full → el stock vive en un centro de ML, no en la bodega;
     · variantes sin control de stock en TN → no hay número que comparar;
     · canal no conectado → no se puede afirmar nada de él.
   `falta*` = vinculado pero la publicación ya no aparece en el catálogo. */
export function stockEnCanales(f: FilaCRM, l: LecturaCanales) {
  const enTN = f.tiendanube_variant_id != null;
  const enML = f.meli_item_id != null && !esFull(f);

  const tn = enTN && l.productosTN ? (l.stockTN.get(f.tiendanube_variant_id!) ?? null) : null;
  const ml = enML && l.itemsML ? (l.stockML.get(clave(f.meli_item_id!, f.meli_variation_id)) ?? null) : null;

  return {
    enTN,
    enML,
    tn,
    ml,
    faltaEnTN:
      enTN && l.productosTN != null && tn === null && !l.sinControlTN.has(f.tiendanube_variant_id!),
    faltaEnML: enML && l.itemsML != null && ml === null,
  };
}

export type ResumenReconciliacion = {
  revisados: number; // productos vinculados a algún canal que se compararon
  descuadres: Descuadre[];
  /* Fichas distintas del CRM que en realidad son el mismo artículo en ML
     (publicación original + gemela de catálogo, misma bodega). */
  duplicados: GrupoDuplicado[];
  tnConectada: boolean;
  mlConectada: boolean;
};

export async function reconciliarInventario(): Promise<ResumenReconciliacion> {
  const lectura = await leerCanales();

  const descuadres: Descuadre[] = [];
  for (const f of lectura.filas) {
    const { enTN, enML, tn, ml, faltaEnTN, faltaEnML } = stockEnCanales(f, lectura);

    const difiereTN = tn !== null && tn !== f.stock;
    const difiereML = ml !== null && ml !== f.stock;

    if (difiereTN || difiereML || faltaEnTN || faltaEnML) {
      descuadres.push({
        id: f.id,
        nombre: f.nombre,
        variante: f.variante,
        sku: f.sku,
        tipo: f.tipo,
        es_combo:
          (f.tiendanube_variant_id != null && lectura.sinControlTN.has(f.tiendanube_variant_id)) ||
          !!f.bajo_pedido,
        stock_crm: f.stock,
        stock_tn: enTN ? tn : null,
        stock_ml: enML ? ml : null,
        falta_en_tn: faltaEnTN,
        falta_en_ml: faltaEnML,
      });
    }
  }

  // Aprovecha el catálogo de ML que ya se leyó arriba: no cuesta otra pasada.
  const porBodega = await detectarDuplicadosML(lectura.itemsML);
  // Y, sobre lo que ese criterio no cubrió, las fichas que comparten SKU con una
  // de Tienda Nube (típico al corregir el SKU en ML después de la importación).
  const cubiertas = new Set(porBodega.flatMap((g) => g.fichas.map((f) => f.id)));
  const porSku = await detectarDuplicadosPorSku(cubiertas);

  return {
    revisados: lectura.filas.length,
    descuadres,
    duplicados: [...porBodega, ...porSku],
    tnConectada: lectura.productosTN != null,
    mlConectada: lectura.itemsML != null,
  };
}
