/* ============================================================================
   lib/tiendanube/sync.ts — Sincronización Tienda Nube → tabla `products`
   ----------------------------------------------------------------------------
   Cada variante de Tienda Nube es un renglón de `products`, mapeado por
   `tiendanube_variant_id` (unique). El upsert es idempotente: los reintentos
   de webhooks y la reconciliación diaria pueden repetirse sin duplicar nada.
   Corre con el service role porque webhooks y cron no traen sesión.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/lib/supabase/tipos-bd";
import { aplicarCambiosProductos } from "@/lib/inventario/escribir-productos";
import { mezclarDatosIntegracion } from "@/lib/canales/integraciones";
import { traerTodo } from "@/lib/canales/paginacion";
import { traerPorLotes } from "@/lib/supabase/lotes";
import {
  actualizarVarianteTN,
  conexionTiendanube,
  listarProductosTN,
  type ConexionTN,
  type ProductoTN,
} from "@/lib/tiendanube/api";
import { propagarStock, type FilaVinculada } from "@/lib/inventario/stock-hub";
import { registrarStockLog, type EntradaStockLog } from "@/lib/inventario/stock-log";
import { HUB_VENTAS_ACTIVO } from "@/lib/inventario/hub-config";
import { esSimulacro, puedeEscribir } from "@/lib/inventario/escritura-canales";
import { tipoDesdeProducto } from "@/lib/inventario/tipo-producto";

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

  // Mapa variante TN → renglón existente (consulta en tandas para no armar
  // URLs kilométricas con .in()). Trae stock y vínculo ML para el hub.
  type FilaExistente = {
    id: string;
    tiendanube_variant_id: number;
    stock: number;
    meli_item_id: string | null;
    meli_variation_id: number | null;
    /* Mercado Full: el hub no debe escribirle stock (vive en un centro de ML). */
    meli_logistic_type: string | null;
    /* Bajo pedido: sin control de stock, el hub no le escribe a ningún canal. */
    bajo_pedido: boolean;
  };
  const idsVariantes = productos.flatMap((p) => p.variants.map((v) => v.id));
  /* Troceado por el techo de URL de PostgREST, en oleadas paralelas: era un
     bucle secuencial que pagaba cada tanda como un viaje completo. */
  const filas = await traerPorLotes<number, FilaExistente>(idsVariantes, (lote) =>
    admin
      .from("products")
      .select(
        "id, tiendanube_variant_id, stock, meli_item_id, meli_variation_id, meli_logistic_type, bajo_pedido",
      )
      .in("tiendanube_variant_id", lote),
  );
  const existentes = new Map<number, FilaExistente>();
  for (const fila of filas) existentes.set(fila.tiendanube_variant_id, fila);

  const nuevos: TablesInsert<"products">[] = [];
  const cambios: { id: string; fila: Record<string, unknown> }[] = [];
  // Stock que cambió en TN y cuya fila también vive en Mercado Libre → hub.
  const propagarAML: FilaVinculada[] = [];
  /* Con el hub activo: filas donde el canal se salió del número del CRM y hay
     que devolverlas a él (el CRM es la fuente de verdad). */
  const corregirDesdeCRM: FilaVinculada[] = [];
  const logs: EntradaStockLog[] = []; // adopción local del stock de TN, para el ledger

  for (const p of productos) {
    const nombre = texto(p.name) || `Producto ${p.id}`;
    // Galería completa del producto (URLs del CDN de TN), ordenada por posición.
    const imagenes = [...(p.images ?? [])].sort((a, b) => a.position - b.position).map((i) => i.src);
    for (const v of p.variants) {
      const variante = (v.values ?? []).map(texto).filter(Boolean).join(" / ") || null;
      // Portada de la variante: su imagen propia si la tiene, si no la del producto.
      const imagenVariante = v.image_id ? (p.images ?? []).find((i) => i.id === v.image_id)?.src : null;
      const fila: TablesInsert<"products"> = {
        nombre,
        variante,
        precio: numero(v.price),
        costo: numero(v.cost),
        sku: v.sku || null,
        activo: p.published !== false,
        tiendanube_product_id: p.id,
        tiendanube_variant_id: v.id,
        imagen_url: imagenVariante ?? imagenes[0] ?? null,
        imagenes,
        /* Solo si viene: un payload sin canonical_url no borra el guardado. */
        ...(p.canonical_url?.trim() ? { tiendanube_permalink: p.canonical_url.trim() } : {}),
      };
      const existente = existentes.get(v.id);
      const nuevoStock = typeof v.stock === "number" ? Math.max(0, v.stock) : null;

      /* ¿Quién manda el stock de ESTE producto?

         Por defecto Tienda Nube lo dicta y el CRM adopta su número, que es como
         funcionó siempre.

         El CRM manda solo cuando se le entregó el mando de verdad: hub de ventas
         activo Y escritura real habilitada para este canal y este SKU. Entonces
         adoptar sería darle la vuelta al modelo, porque el número del CRM ya
         refleja las ventas de TODOS los canales (cada una lo descuenta al
         importarse) mientras que el de Tienda Nube solo conoce las suyas:
         copiarlo borraría las ventas de Mercado Libre. En su lugar se detecta la
         diferencia y se empuja la del CRM.

         La decisión es POR PRODUCTO a propósito: durante el piloto solo los SKUs
         de la lista blanca cambian de modelo, y los demás siguen exactamente
         como hoy. En simulacro tampoco cambia: ahí solo se observa. */
      const crmManda =
        HUB_VENTAS_ACTIVO && !esSimulacro() && puedeEscribir("tiendanube", v.sku);
      const adoptaStock = !crmManda;
      if (adoptaStock && nuevoStock !== null) fila.stock = nuevoStock;

      if (existente) {
        cambios.push({ id: existente.id, fila });
        if (nuevoStock !== null && nuevoStock !== existente.stock) {
          const enlace = {
            id: existente.id,
            sku: v.sku || null,
            tiendanube_product_id: p.id,
            tiendanube_variant_id: v.id,
            meli_item_id: existente.meli_item_id,
            meli_variation_id: existente.meli_variation_id,
            meli_logistic_type: existente.meli_logistic_type ?? null,
            bajo_pedido: existente.bajo_pedido,
          };
          if (adoptaStock) {
            // Modelo viejo: TN manda. El CRM adopta y reenvía a Mercado Libre.
            logs.push({
              producto_id: existente.id,
              canal: "crm",
              origen: "tiendanube_sync",
              stock_anterior: existente.stock,
              stock_nuevo: nuevoStock,
            });
            if (existente.meli_item_id) {
              propagarAML.push({
                ...enlace,
                stock: nuevoStock,
                // El movimiento que Tienda Nube acaba de aplicar (venta o ajuste).
                delta: nuevoStock - existente.stock,
              });
            }
          } else {
            /* Modelo nuevo: manda el CRM. Tienda Nube quedó desalineada (una
               venta que ya contamos, un ajuste hecho en su panel…) y se le
               devuelve el número del CRM. Va SIN delta: no es un movimiento que
               haya que sumar, es una corrección hacia la fuente de verdad. El
               hub lee cada canal antes de escribir y solo toca el que difiera,
               así que este mismo empuje realinea Tienda Nube y Mercado Libre. */
            corregirDesdeCRM.push({ ...enlace, stock: existente.stock, delta: null });
          }
        }
      } else {
        nuevos.push({
          ...fila,
          tipo: tipoDesdeProducto({ nombre, sku: v.sku }),
          stock: typeof v.stock === "number" ? Math.max(0, v.stock) : 0,
        });
      }
    }
  }

  if (nuevos.length > 0) {
    const { error } = await admin.from("products").insert(nuevos);
    if (error) throw new Error(error.message);
  }
  /* Aquí TODOS los cambios traen la ficha completa (Tienda Nube manda el
     catálogo: nombre, variante, precio, costo, sku, estado y fotos), así que se
     escriben de verdad en lote: la pasada diaria pasó de un viaje por variante a
     un puñado de viajes. Las que además llevan `stock` viajan en su propio lote
     —lo agrupa el helper por columnas—, de modo que a las fichas donde manda el
     CRM se les sigue sin tocar el stock. */
  await aplicarCambiosProductos(admin, cambios);

  /* Hub de stock. Los dos empujes son excluyentes —dependen de quién mande— y
     ambos son no-op mientras la escritura a canales esté apagada (el default).
     Nunca rompen la sync a la base: los fallos solo se loggean. */
  if (propagarAML.length > 0) {
    // Modelo viejo: lo que cambió en Tienda Nube se reenvía a Mercado Libre.
    try {
      (await propagarStock("tiendanube", propagarAML)).forEach((e) =>
        console.error("[stock-hub] TN→ML:", e),
      );
    } catch (e) {
      console.error("[stock-hub] TN→ML:", e);
    }
  }
  if (corregirDesdeCRM.length > 0) {
    // Modelo nuevo: el CRM manda y devuelve a los canales a su número.
    try {
      (await propagarStock("crm", corregirDesdeCRM)).forEach((e) =>
        console.error("[stock-hub] CRM→canales:", e),
      );
    } catch (e) {
      console.error("[stock-hub] CRM→canales:", e);
    }
  }

  await registrarStockLog(logs);
  return { creados: nuevos.length, actualizados: cambios.length };
}

/* Sync inversa (CRM → Tienda Nube): empuja stock/precio/costo de un renglón
   vinculado. Silencioso para productos manuales (sin IDs de Tienda Nube), y
   no-op mientras la escritura a canales esté apagada (el default: ver el
   candado en actualizarVarianteTN). El webhook product/updated que la tienda
   dispara de vuelta re-escribe los mismos valores, así que no hay bucle:
   converge en una vuelta. */
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

/* Espeja las categorías de Tienda Nube (junta 13/08): el árbol en
   `tn_categorias` y la pertenencia por renglón en `product_tn_categorias`.
   Solo lectura para el CRM — la tienda decide, esto refleja.

   Corre tras el upsert de productos (las filas ya existen) y con el catálogo
   COMPLETO en mano: así podar lo que un producto dejó de tener es seguro. Las
   relaciones se insertan primero y se poda después, la regla de la casa. */
export async function sincronizarCategoriasTN(productos: ProductoTN[]): Promise<void> {
  const admin = createAdminClient();

  /* 1. El árbol: únicas por id, con nombre y padre tal como los manda TN. */
  const categorias = new Map<number, { id: number; nombre: string; parent_id: number | null }>();
  for (const p of productos) {
    for (const c of p.categories ?? []) {
      categorias.set(c.id, {
        id: c.id,
        nombre: texto(c.name) || `Categoría ${c.id}`,
        parent_id: c.parent ?? null,
      });
    }
  }
  if (categorias.size > 0) {
    const { error } = await admin
      .from("tn_categorias")
      .upsert([...categorias.values()].map((c) => ({ ...c, actualizado_en: new Date().toISOString() })));
    if (error) throw new Error(error.message);
  }

  /* 2. La pertenencia: cada variante hereda las categorías de su producto. */
  const categoriasPorProductoTN = new Map<number, number[]>();
  for (const p of productos) {
    categoriasPorProductoTN.set(p.id, (p.categories ?? []).map((c) => c.id));
  }
  const idsProductoTN = [...categoriasPorProductoTN.keys()];
  if (idsProductoTN.length === 0) return;

  const filas = await traerPorLotes<number, { id: string; tiendanube_product_id: number }>(
    idsProductoTN,
    (lote) =>
      admin
        .from("products")
        .select("id, tiendanube_product_id")
        .in("tiendanube_product_id", lote),
  );

  const deseadas: { product_id: string; categoria_id: number }[] = [];
  const deseadasPorFila = new Map<string, Set<number>>();
  for (const f of filas) {
    const ids = categoriasPorProductoTN.get(f.tiendanube_product_id) ?? [];
    deseadasPorFila.set(f.id, new Set(ids));
    for (const cid of ids) deseadas.push({ product_id: f.id, categoria_id: cid });
  }

  /* Insertar (ignorando las que ya están: PK compuesta) y DESPUÉS podar. */
  const LOTE = 500;
  for (let i = 0; i < deseadas.length; i += LOTE) {
    const { error } = await admin
      .from("product_tn_categorias")
      .upsert(deseadas.slice(i, i + LOTE), { ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  const existentes = await traerPorLotes<string, { product_id: string; categoria_id: number }>(
    [...deseadasPorFila.keys()],
    (lote) =>
      admin
        .from("product_tn_categorias")
        .select("product_id, categoria_id")
        .in("product_id", lote),
  );
  const sobrantes = existentes.filter(
    (r) => !(deseadasPorFila.get(r.product_id)?.has(r.categoria_id) ?? false),
  );
  for (const r of sobrantes) {
    const { error } = await admin
      .from("product_tn_categorias")
      .delete()
      .eq("product_id", r.product_id)
      .eq("categoria_id", r.categoria_id);
    if (error) throw new Error(error.message);
  }
}

/* Importación inicial y reconciliación (cron diario / botón manual): trae el
   catálogo completo, upserta y desactiva variantes que ya no existen. */
export async function sincronizacionCompleta(cx?: ConexionTN): Promise<ResumenSync> {
  const conexion = cx ?? (await conexionTiendanube());
  if (!conexion) throw new Error("Tienda Nube no está conectada.");

  const productos = await listarProductosTN(conexion);
  const { creados, actualizados } = await sincronizarProductosTN(productos);
  /* Las categorías de la tienda, espejadas. Que su fallo no tire la sync de
     stock: son organización, no inventario. */
  try {
    await sincronizarCategoriasTN(productos);
  } catch (e) {
    console.error("[tiendanube] categorías no sincronizadas:", e);
  }

  const admin = createAdminClient();
  const vivos = new Set(productos.flatMap((p) => p.variants.map((v) => v.id)));
  /* Paginado con traerTodo: las fichas con vínculo rondan el corte de ~1000 de
     PostgREST, y con la lista a medias los sobrantes de la cola alfabética
     nunca se daban de baja — quedaban «activos» apuntando a variantes que ya
     no existen en la tienda. */
  const sincronizados = await traerTodo<{ id: string; tiendanube_variant_id: number }>(
    (desde, hasta) =>
      admin
        .from("products")
        .select("id, tiendanube_variant_id")
        .not("tiendanube_variant_id", "is", null)
        .eq("activo", true)
        .order("id")
        .range(desde, hasta),
  );

  const sobrantes = sincronizados
    .filter((f) => !vivos.has(f.tiendanube_variant_id))
    .map((f) => f.id);
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
  // Merge sobre `datos` para no pisar el estado de otras syncs (p. ej. ventas).
  await mezclarDatosIntegracion("tiendanube", { ultima_sync: new Date().toISOString(), ...resumen });

  return resumen;
}
