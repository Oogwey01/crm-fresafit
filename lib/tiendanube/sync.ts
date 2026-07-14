/* ============================================================================
   lib/tiendanube/sync.ts — Sincronización Tienda Nube → tabla `products`
   ----------------------------------------------------------------------------
   Cada variante de Tienda Nube es un renglón de `products`, mapeado por
   `tiendanube_variant_id` (unique). El upsert es idempotente: los reintentos
   de webhooks y la reconciliación diaria pueden repetirse sin duplicar nada.
   Corre con el service role porque webhooks y cron no traen sesión.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  actualizarVarianteTN,
  conexionTiendanube,
  listarProductosTN,
  type ConexionTN,
  type ProductoTN,
} from "@/lib/tiendanube/api";
import type { TipoProductoId } from "@/lib/types";

export type ResumenSync = {
  productos: number;
  creados: number;
  actualizados: number;
  desactivados: number;
};

/* Primer texto disponible de un campo multiidioma ({ es: "..." }). */
function texto(multi: Record<string, string> | null | undefined): string {
  if (!multi) return "";
  return (multi.es ?? Object.values(multi)[0] ?? "").trim();
}

/* Clasificación por palabras clave del nombre. Solo aplica al CREAR el
   renglón; si después lo reclasifican a mano, la sync no lo pisa. */
function tipoDesdeNombre(nombre: string): TipoProductoId {
  const n = nombre.toLowerCase();
  if (n.includes("cintur")) return "cinturones";
  if (n.includes("strap")) return "straps";
  if (n.includes("muñequ") || n.includes("munequ")) return "munequeras";
  if (n.includes("mochila") || n.includes("backpack")) return "mochilas";
  if (/playera|camiseta|sudadera|hoodie|short|legging|jogger|gorra|calceta|top\b/.test(n)) return "ropa";
  return "otro";
}

/* Los montos llegan como string ("249.00"). */
function numero(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* Upsert de todas las variantes de un lote de productos de Tienda Nube. */
export async function sincronizarProductosTN(
  productos: ProductoTN[],
): Promise<{ creados: number; actualizados: number }> {
  const admin = createAdminClient();

  // Mapa variante TN → id de renglón existente (consulta en tandas para no
  // armar URLs kilométricas con .in()).
  const idsVariantes = productos.flatMap((p) => p.variants.map((v) => v.id));
  const existentes = new Map<number, string>();
  for (let i = 0; i < idsVariantes.length; i += 200) {
    const { data, error } = await admin
      .from("products")
      .select("id, tiendanube_variant_id")
      .in("tiendanube_variant_id", idsVariantes.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const fila of data ?? []) existentes.set(fila.tiendanube_variant_id as number, fila.id as string);
  }

  const nuevos: Record<string, unknown>[] = [];
  const cambios: { id: string; fila: Record<string, unknown> }[] = [];

  for (const p of productos) {
    const nombre = texto(p.name) || `Producto ${p.id}`;
    for (const v of p.variants) {
      const variante = (v.values ?? []).map(texto).filter(Boolean).join(" / ") || null;
      const fila: Record<string, unknown> = {
        nombre,
        variante,
        precio: numero(v.price),
        costo: numero(v.cost),
        sku: v.sku || null,
        activo: p.published !== false,
        tiendanube_product_id: p.id,
        tiendanube_variant_id: v.id,
        // stock null en TN = "sin control de stock": no pisar el conteo local.
        ...(typeof v.stock === "number" ? { stock: Math.max(0, v.stock) } : {}),
      };
      const idExistente = existentes.get(v.id);
      if (idExistente) {
        cambios.push({ id: idExistente, fila });
      } else {
        nuevos.push({
          ...fila,
          tipo: tipoDesdeNombre(nombre),
          stock: typeof v.stock === "number" ? Math.max(0, v.stock) : 0,
        });
      }
    }
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

  return { creados: nuevos.length, actualizados: cambios.length };
}

/* Sync inversa (CRM → Tienda Nube): empuja stock/precio/costo de un renglón
   vinculado. Silencioso para productos manuales (sin IDs de Tienda Nube).
   El webhook product/updated que la tienda dispara de vuelta re-escribe los
   mismos valores, así que no hay bucle: converge en una vuelta. */
export async function empujarProductoTN(fila: {
  tiendanube_product_id: number | null;
  tiendanube_variant_id: number | null;
  stock?: number;
  precio?: number | null;
  costo?: number | null;
}): Promise<void> {
  if (!fila.tiendanube_product_id || !fila.tiendanube_variant_id) return;
  const cx = await conexionTiendanube();
  if (!cx) throw new Error("Tienda Nube no está conectada.");
  const cambios: { stock?: number; price?: number; cost?: number } = {};
  if (typeof fila.stock === "number") cambios.stock = fila.stock;
  if (typeof fila.precio === "number") cambios.price = fila.precio;
  if (typeof fila.costo === "number") cambios.cost = fila.costo;
  if (Object.keys(cambios).length === 0) return;
  await actualizarVarianteTN(cx, fila.tiendanube_product_id, fila.tiendanube_variant_id, cambios);
}

/* Baja lógica cuando borran un producto en Tienda Nube (no se elimina el
   renglón: puede estar referido por pedidos a proveedor). */
export async function desactivarProductoTN(productId: number): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("products")
    .update({ activo: false })
    .eq("tiendanube_product_id", productId);
  if (error) throw new Error(error.message);
}

/* Importación inicial y reconciliación (cron diario / botón manual): trae el
   catálogo completo, upserta y desactiva variantes que ya no existen. */
export async function sincronizacionCompleta(cx?: ConexionTN): Promise<ResumenSync> {
  const conexion = cx ?? (await conexionTiendanube());
  if (!conexion) throw new Error("Tienda Nube no está conectada.");

  const productos = await listarProductosTN(conexion);
  const { creados, actualizados } = await sincronizarProductosTN(productos);

  const admin = createAdminClient();
  const vivos = new Set(productos.flatMap((p) => p.variants.map((v) => v.id)));
  const { data: sincronizados, error } = await admin
    .from("products")
    .select("id, tiendanube_variant_id")
    .not("tiendanube_variant_id", "is", null)
    .eq("activo", true);
  if (error) throw new Error(error.message);

  const sobrantes = (sincronizados ?? [])
    .filter((f) => !vivos.has(f.tiendanube_variant_id as number))
    .map((f) => f.id as string);
  if (sobrantes.length > 0) {
    const { error: errBaja } = await admin.from("products").update({ activo: false }).in("id", sobrantes);
    if (errBaja) throw new Error(errBaja.message);
  }

  const resumen: ResumenSync = {
    productos: productos.length,
    creados,
    actualizados,
    desactivados: sobrantes.length,
  };
  await admin
    .from("integraciones")
    .update({ datos: { ultima_sync: new Date().toISOString(), ...resumen } })
    .eq("id", "tiendanube");

  return resumen;
}
