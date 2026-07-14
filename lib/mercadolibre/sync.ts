/* ============================================================================
   lib/mercadolibre/sync.ts — Sincronización Mercado Libre → tabla `products`
   ----------------------------------------------------------------------------
   Cada "unidad" de ML (item sin variaciones, o item+variación) es un renglón
   de `products`, mapeado por (meli_item_id, meli_variation_id).

   Matching al importar (stock unificado con Tienda Nube):
     1. Unidad ya vinculada → esa fila.
     2. Sin vincular y con SKU → si EXACTAMENTE una fila del CRM tiene ese sku
        y sigue sin vínculo ML, se vincula (caso típico: producto que vino de
        Tienda Nube con el mismo SKU). Con 0 o 2+ candidatas: fila nueva,
        nunca se adivina.
     3. Sin SKU → fila nueva siempre.

   Anti-bucle: el stock solo se adopta y propaga cuando DIFIERE del guardado.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  conexionMercadolibre,
  listarItemsML,
  obtenerItemML,
  skuML,
  type ConexionML,
  type ItemML,
} from "@/lib/mercadolibre/api";
import { propagarStock, type FilaVinculada } from "@/lib/inventario/stock-hub";
import { tipoDesdeNombre } from "@/lib/inventario/tipo-producto";

export type ResumenSyncML = {
  items: number;
  creados: number;
  actualizados: number;
  vinculados: number;
  desactivados: number;
};

type UnidadML = {
  itemId: string;
  variationId: number | null;
  sku: string | null;
  nombre: string;
  variante: string | null;
  precio: number | null;
  stock: number;
  activo: boolean;
};

type FilaProducto = {
  id: string;
  stock: number;
  sku: string | null;
  tiendanube_product_id: number | null;
  tiendanube_variant_id: number | null;
  meli_item_id: string | null;
  meli_variation_id: number | null;
};

const CAMPOS_FILA = "id, stock, sku, tiendanube_product_id, tiendanube_variant_id, meli_item_id, meli_variation_id";

function clave(itemId: string, variationId: number | null): string {
  return `${itemId}:${variationId ?? ""}`;
}

function unidadesDe(item: ItemML): UnidadML[] {
  const activo = item.status !== "closed";
  if (item.variations?.length) {
    return item.variations.map((v) => ({
      itemId: item.id,
      variationId: v.id,
      sku: skuML(v) ?? skuML(item),
      nombre: item.title,
      variante:
        (v.attribute_combinations ?? [])
          .map((a) => a.value_name?.trim())
          .filter(Boolean)
          .join(" / ") || null,
      precio: v.price ?? item.price ?? null,
      stock: Math.max(0, v.available_quantity ?? 0),
      activo,
    }));
  }
  return [
    {
      itemId: item.id,
      variationId: null,
      sku: skuML(item),
      nombre: item.title,
      variante: null,
      precio: item.price ?? null,
      stock: Math.max(0, item.available_quantity ?? 0),
      activo,
    },
  ];
}

/* Upsert de un lote de items de ML, con matching por SKU y propagación. */
export async function sincronizarItemsML(
  items: ItemML[],
): Promise<Omit<ResumenSyncML, "items" | "desactivados">> {
  const admin = createAdminClient();
  const unidades = items.flatMap(unidadesDe);
  const itemIds = [...new Set(unidades.map((u) => u.itemId))];

  // 1) Filas ya vinculadas a estas unidades (consulta en tandas).
  const vinculadas = new Map<string, FilaProducto>();
  for (let i = 0; i < itemIds.length; i += 100) {
    const { data, error } = await admin
      .from("products")
      .select(CAMPOS_FILA)
      .in("meli_item_id", itemIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as FilaProducto[]) {
      vinculadas.set(clave(f.meli_item_id!, f.meli_variation_id), f);
    }
  }

  // 2) Candidatas por SKU para las unidades aún sin vínculo.
  const skusBuscados = [
    ...new Set(
      unidades
        .filter((u) => !vinculadas.has(clave(u.itemId, u.variationId)) && u.sku)
        .map((u) => u.sku as string),
    ),
  ];
  const porSku = new Map<string, FilaProducto[]>();
  for (let i = 0; i < skusBuscados.length; i += 100) {
    const { data, error } = await admin
      .from("products")
      .select(CAMPOS_FILA)
      .in("sku", skusBuscados.slice(i, i + 100))
      .is("meli_item_id", null);
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as FilaProducto[]) {
      porSku.set(f.sku!, [...(porSku.get(f.sku!) ?? []), f]);
    }
  }

  const nuevos: Record<string, unknown>[] = [];
  const cambios: { id: string; fila: Record<string, unknown> }[] = [];
  const adoptadosDeML: FilaVinculada[] = []; // stock de ML difiere → empujar a TN
  const alinearML: FilaVinculada[] = []; // al vincular, el CRM manda → empujar a ML
  const reclamadas = new Set<string>();
  let vinculados = 0;

  for (const u of unidades) {
    const meliIds = { meli_item_id: u.itemId, meli_variation_id: u.variationId };
    const existente = vinculadas.get(clave(u.itemId, u.variationId));

    if (existente) {
      const esDeTN = existente.tiendanube_variant_id != null;
      const stockCambio = u.stock !== existente.stock;
      const fila: Record<string, unknown> = esDeTN
        ? // Vinculada también a Tienda Nube: nombre/variante/precio/activo los
          // manda TN; de ML solo se adopta el stock.
          stockCambio
          ? { stock: u.stock }
          : {}
        : {
            nombre: u.nombre,
            variante: u.variante,
            precio: u.precio,
            sku: u.sku,
            activo: u.activo,
            ...(stockCambio ? { stock: u.stock } : {}),
          };
      if (Object.keys(fila).length > 0) cambios.push({ id: existente.id, fila });
      if (stockCambio && esDeTN) {
        adoptadosDeML.push({ ...existente, ...meliIds, stock: u.stock });
      }
      continue;
    }

    const candidatas = (u.sku && porSku.get(u.sku)?.filter((f) => !reclamadas.has(f.id))) || [];
    if (candidatas.length === 1) {
      // Match único por SKU → vincular. En el momento de vincular, el stock
      // vigente del CRM (que viene de Tienda Nube) es la verdad: se conserva
      // y se alinea Mercado Libre hacia él si difiere.
      const fila = candidatas[0];
      reclamadas.add(fila.id);
      cambios.push({ id: fila.id, fila: meliIds });
      vinculados++;
      if (u.stock !== fila.stock) {
        alinearML.push({ ...fila, ...meliIds });
      }
      continue;
    }

    // Sin SKU, sin match o SKU ambiguo (duplicado) → fila nueva.
    nuevos.push({
      nombre: u.nombre,
      variante: u.variante,
      tipo: tipoDesdeNombre(u.nombre),
      precio: u.precio,
      sku: u.sku,
      stock: u.stock,
      activo: u.activo,
      ...meliIds,
    });
  }

  if (nuevos.length > 0) {
    const { error } = await admin.from("products").insert(nuevos);
    if (error) throw new Error(error.message);
  }
  for (let i = 0; i < cambios.length; i += 10) {
    await Promise.all(
      cambios.slice(i, i + 10).map(async ({ id, fila }) => {
        const { error } = await admin.from("products").update(fila).eq("id", id);
        if (error) throw new Error(error.message);
      }),
    );
  }

  // Propagación (nunca rompe la sync a la base: solo se loggea).
  try {
    if (adoptadosDeML.length > 0) {
      (await propagarStock("mercadolibre", adoptadosDeML)).forEach((e) =>
        console.error("[stock-hub] ML→TN:", e),
      );
    }
    if (alinearML.length > 0) {
      // Origen "tiendanube" = no reenviar a TN (el valor vigente ya es suyo);
      // solo alinear Mercado Libre.
      (await propagarStock("tiendanube", alinearML)).forEach((e) =>
        console.error("[stock-hub] vincular→ML:", e),
      );
    }
  } catch (e) {
    console.error("[stock-hub] propagación:", e);
  }

  return { creados: nuevos.length, actualizados: cambios.length - vinculados, vinculados };
}

/* Sync de un solo item (lo dispara la notificación de ML). */
export async function sincronizarItemML(itemId: string): Promise<void> {
  const cx = await conexionMercadolibre();
  if (!cx) return;
  const item = await obtenerItemML(cx, itemId);
  if (item) {
    await sincronizarItemsML([item]);
    return;
  }
  // Item eliminado: baja lógica solo de renglones que viven únicamente en ML
  // (los vinculados a Tienda Nube siguen gobernados por TN).
  const admin = createAdminClient();
  const { error } = await admin
    .from("products")
    .update({ activo: false })
    .eq("meli_item_id", itemId)
    .is("tiendanube_variant_id", null);
  if (error) throw new Error(error.message);
}

/* Importación inicial y reconciliación (cron 6:30 UTC / botón manual). */
export async function importacionCompletaML(cx?: ConexionML): Promise<ResumenSyncML> {
  const conexion = cx ?? (await conexionMercadolibre());
  if (!conexion) throw new Error("Mercado Libre no está conectado.");

  const items = await listarItemsML(conexion);
  const resumenLote = await sincronizarItemsML(items);

  // Renglones solo-ML cuyo item ya no existe en el catálogo → inactivos.
  const admin = createAdminClient();
  const vivos = new Set(items.flatMap((i) => unidadesDe(i).map((u) => clave(u.itemId, u.variationId))));
  const { data: enBase, error } = await admin
    .from("products")
    .select("id, meli_item_id, meli_variation_id")
    .not("meli_item_id", "is", null)
    .is("tiendanube_variant_id", null)
    .eq("activo", true);
  if (error) throw new Error(error.message);
  const sobrantes = ((enBase ?? []) as FilaProducto[])
    .filter((f) => !vivos.has(clave(f.meli_item_id!, f.meli_variation_id)))
    .map((f) => f.id);
  if (sobrantes.length > 0) {
    const { error: errBaja } = await admin.from("products").update({ activo: false }).in("id", sobrantes);
    if (errBaja) throw new Error(errBaja.message);
  }

  const resumen: ResumenSyncML = { items: items.length, ...resumenLote, desactivados: sobrantes.length };

  // `datos` se escribe con merge para no perder nada más que viva ahí.
  const { data: filaInt } = await admin
    .from("integraciones")
    .select("datos")
    .eq("id", "mercadolibre")
    .maybeSingle();
  await admin
    .from("integraciones")
    .update({
      datos: { ...((filaInt?.datos as object) ?? {}), ultima_sync: new Date().toISOString(), ...resumen },
    })
    .eq("id", "mercadolibre");

  return resumen;
}
