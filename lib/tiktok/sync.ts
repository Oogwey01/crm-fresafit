/* ============================================================================
   lib/tiktok/sync.ts — Sincronización TikTok Shop → tabla `products`
   ----------------------------------------------------------------------------
   Cada SKU de TikTok es un renglón de `products`, mapeado por
   (tiktok_product_id, tiktok_sku_id). Matching al importar (igual que ML):
     1. SKU ya vinculado → esa fila.
     2. Sin vincular y con seller_sku → si EXACTAMENTE una fila del CRM tiene ese
        sku y sigue sin vínculo TikTok, se vincula. Con 0 o 2+: fila nueva.
     3. Sin seller_sku → fila nueva siempre.
   El stock de TikTok es por almacén; se suma el inventario de todos los
   almacenes del SKU. El almacén principal (para escribir stock) se guarda en
   integraciones.datos al conectar. Solo servidor (service role).
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  conexionTiktok,
  listarProductosTikTok,
  type ConexionTikTok,
  type ProductoTikTok,
  type SkuTikTok,
} from "@/lib/tiktok/api";
import { tipoDesdeProducto } from "@/lib/inventario/tipo-producto";

export type ResumenSyncTikTok = {
  productos: number;
  creados: number;
  actualizados: number;
  vinculados: number;
  desactivados: number;
};

type UnidadTikTok = {
  productId: string;
  skuId: string;
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
  tiktok_product_id: string | null;
  tiktok_sku_id: string | null;
};

const CAMPOS_FILA = "id, stock, sku, tiktok_product_id, tiktok_sku_id";

function numero(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function precioDe(sku: SkuTikTok): number | null {
  return numero(sku.price?.sale_price) ?? numero(sku.price?.tax_exclusive_price);
}

function stockDe(sku: SkuTikTok): number {
  return Math.max(0, (sku.inventory ?? []).reduce((a, i) => a + (i.quantity ?? 0), 0));
}

function varianteDe(sku: SkuTikTok): string | null {
  return (
    (sku.sales_attributes ?? [])
      .map((a) => a.value_name?.trim())
      .filter(Boolean)
      .join(" / ") || null
  );
}

function unidadesDe(p: ProductoTikTok): UnidadTikTok[] {
  const activo = p.status === "ACTIVATE";
  return (p.skus ?? []).map((s) => ({
    productId: p.id,
    skuId: s.id,
    sku: s.seller_sku?.trim() || null,
    nombre: p.title || `Producto ${p.id}`,
    variante: varianteDe(s),
    precio: precioDe(s),
    stock: stockDe(s),
    activo,
  }));
}

/* Upsert de un lote de productos de TikTok, con matching por SKU. */
export async function sincronizarProductosTikTok(
  productos: ProductoTikTok[],
): Promise<Omit<ResumenSyncTikTok, "productos" | "desactivados">> {
  const admin = createAdminClient();
  const unidades = productos.flatMap(unidadesDe);
  const skuIds = [...new Set(unidades.map((u) => u.skuId))];

  // 1) Filas ya vinculadas a estos SKUs.
  const vinculadas = new Map<string, FilaProducto>();
  for (let i = 0; i < skuIds.length; i += 100) {
    const { data, error } = await admin
      .from("products")
      .select(CAMPOS_FILA)
      .in("tiktok_sku_id", skuIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as FilaProducto[]) vinculadas.set(f.tiktok_sku_id!, f);
  }

  // 2) Candidatas por SKU para las unidades aún sin vínculo.
  const skusBuscados = [
    ...new Set(unidades.filter((u) => !vinculadas.has(u.skuId) && u.sku).map((u) => u.sku as string)),
  ];
  const porSku = new Map<string, FilaProducto[]>();
  for (let i = 0; i < skusBuscados.length; i += 100) {
    const { data, error } = await admin
      .from("products")
      .select(CAMPOS_FILA)
      .in("sku", skusBuscados.slice(i, i + 100))
      .is("tiktok_sku_id", null);
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as FilaProducto[]) porSku.set(f.sku!, [...(porSku.get(f.sku!) ?? []), f]);
  }

  const nuevos: Record<string, unknown>[] = [];
  const cambios: { id: string; fila: Record<string, unknown> }[] = [];
  const reclamadas = new Set<string>();
  let vinculados = 0;

  for (const u of unidades) {
    const tiktokIds = { tiktok_product_id: u.productId, tiktok_sku_id: u.skuId };
    const existente = vinculadas.get(u.skuId);

    if (existente) {
      const fila: Record<string, unknown> = {
        nombre: u.nombre,
        variante: u.variante,
        precio: u.precio,
        sku: u.sku,
        activo: u.activo,
        ...(u.stock !== existente.stock ? { stock: u.stock } : {}),
      };
      cambios.push({ id: existente.id, fila });
      continue;
    }

    const candidatas = (u.sku && porSku.get(u.sku)?.filter((f) => !reclamadas.has(f.id))) || [];
    if (candidatas.length === 1) {
      // Match único por SKU → vincular (conserva el stock vigente del CRM).
      const fila = candidatas[0];
      reclamadas.add(fila.id);
      cambios.push({ id: fila.id, fila: tiktokIds });
      vinculados++;
      continue;
    }

    // Sin SKU, sin match o SKU ambiguo → fila nueva.
    nuevos.push({
      nombre: u.nombre,
      variante: u.variante,
      tipo: tipoDesdeProducto({ nombre: u.nombre, sku: u.sku }),
      precio: u.precio,
      sku: u.sku,
      stock: u.stock,
      activo: u.activo,
      ...tiktokIds,
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

  return { creados: nuevos.length, actualizados: cambios.length - vinculados, vinculados };
}

/* Sync de un solo producto (lo dispara la notificación de TikTok). */
export async function sincronizarProductoTikTok(productId: string): Promise<void> {
  const cx = await conexionTiktok();
  if (!cx) return;
  // El search no filtra por id, así que traemos el catálogo y tomamos el que toca.
  const productos = await listarProductosTikTok(cx);
  const p = productos.find((x) => x.id === productId);
  if (p) {
    await sincronizarProductosTikTok([p]);
    return;
  }
  // Producto eliminado en TikTok: baja lógica de sus renglones solo-TikTok.
  const admin = createAdminClient();
  const { error } = await admin
    .from("products")
    .update({ activo: false })
    .eq("tiktok_product_id", productId)
    .is("tiendanube_variant_id", null)
    .is("meli_item_id", null);
  if (error) throw new Error(error.message);
}

/* Importación inicial y reconciliación (cron / botón). Guarda también el
   almacén principal para poder escribir stock después. */
export async function importacionCompletaTikTok(cx?: ConexionTikTok): Promise<ResumenSyncTikTok> {
  const conexion = cx ?? (await conexionTiktok());
  if (!conexion) throw new Error("TikTok Shop no está conectado.");

  const productos = await listarProductosTikTok(conexion);
  const resumenLote = await sincronizarProductosTikTok(productos);

  // Renglones solo-TikTok cuyo SKU ya no existe → inactivos.
  const admin = createAdminClient();
  const vivos = new Set(productos.flatMap((p) => (p.skus ?? []).map((s) => s.id)));
  const { data: enBase, error } = await admin
    .from("products")
    .select("id, tiktok_sku_id")
    .not("tiktok_sku_id", "is", null)
    .is("tiendanube_variant_id", null)
    .is("meli_item_id", null)
    .eq("activo", true);
  if (error) throw new Error(error.message);
  const sobrantes = ((enBase ?? []) as { id: string; tiktok_sku_id: string }[])
    .filter((f) => !vivos.has(f.tiktok_sku_id))
    .map((f) => f.id);
  if (sobrantes.length > 0) {
    const { error: errBaja } = await admin.from("products").update({ activo: false }).in("id", sobrantes);
    if (errBaja) throw new Error(errBaja.message);
  }

  const resumen: ResumenSyncTikTok = {
    productos: productos.length,
    ...resumenLote,
    desactivados: sobrantes.length,
  };

  const { data: filaInt } = await admin.from("integraciones").select("datos").eq("id", "tiktok").maybeSingle();
  await admin
    .from("integraciones")
    .update({ datos: { ...((filaInt?.datos as object) ?? {}), ultima_sync: new Date().toISOString(), ...resumen } })
    .eq("id", "tiktok");

  return resumen;
}
