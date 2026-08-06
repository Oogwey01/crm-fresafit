"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/supabase/guardia";
import { vistaDinero } from "@/lib/supabase/vista-dinero";
import { adjuntarCostos } from "@/lib/supabase/montos";
import {
  archivoDeFormData,
  rutaParaArchivo,
  subirYRegistrar,
  borrarArchivoYFila,
} from "@/lib/storage";
import { textoONulo } from "@/lib/validacion";
import type { Resultado } from "@/lib/acciones";
import { empujarProductoTN, sincronizacionCompleta } from "@/lib/tiendanube/sync";
import { importacionCompletaML } from "@/lib/mercadolibre/sync";
import { importacionCompletaTikTok } from "@/lib/tiktok/sync";
import { propagarStock } from "@/lib/inventario/stock-hub";
import { registrarStockLog } from "@/lib/inventario/stock-log";
import { conActor } from "@/lib/inventario/actor";
import { reconciliarInventario, type ResumenReconciliacion } from "@/lib/inventario/reconciliacion";
import {
  FILTRO_PUESTA_AL_DIA,
  LIMITE_MOVIMIENTOS,
  LIMITE_PUESTAS_AL_DIA,
  ORIGENES_PUESTA_AL_DIA,
} from "@/lib/inventario/origenes";
import { ESCRITURA_CANALES } from "@/lib/inventario/escritura-canales";
import type {
  ProductPhoto,
  StockLog,
  TipoProductoId,
} from "@/lib/types";

export type ProductoInput = {
  nombre: string;
  tipo: TipoProductoId;
  variante: string;
  costo: number | null;
  precio: number | null;
  stock: number;
  stock_minimo: number;
  proveedor_id: string | null;
  activo: boolean;
  /* Se fabrica contra pedido: no lleva inventario ni alertas de stock. */
  bajo_pedido: boolean;
  /* Línea que ya no se repone (p. ej. OG): fuera de «Qué pedir» y de los avisos. */
  descontinuado: boolean;
  notas: string;
};

/* ============================ Tienda Nube ================================= */

/* Reconciliación manual con el catálogo de Tienda Nube (botón del panel).
   La importación automática corre por webhooks + cron; esto es el respaldo. */
export async function sincronizarTiendanube(): Promise<{ ok: true; detalle: string } | { error: string }> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede sincronizar el inventario.");
  if ("error" in cx) return cx;

  try {
    /* `conActor` firma en el historial los movimientos de esta corrida: una
       sincronización picada a mano no es lo mismo que la del cron de las 6:00,
       y en el ledger se veían idénticas. */
    const r = await conActor(cx.user.id, () => sincronizacionCompleta());
    revalidatePath("/inventario");
    return {
      ok: true,
      detalle: `Sincronizado: ${r.productos} productos (${r.creados} nuevos, ${r.actualizados} actualizados${r.desactivados ? `, ${r.desactivados} desactivados` : ""}).`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falló la sincronización con Tienda Nube." };
  }
}

/* Reporte de descuadres: compara el stock EN VIVO de cada canal contra el del
   CRM y devuelve solo lo que no coincide. Solo lectura: no corrige nada. */
export async function revisarDescuadres(): Promise<
  { ok: true; resumen: ResumenReconciliacion; creadoEn: string } | { error: string }
> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede revisar el inventario.");
  if ("error" in cx) return cx;

  try {
    const resumen = await reconciliarInventario();
    const creadoEn = new Date().toISOString();
    // Se guarda el resultado para que la próxima carga del panel lo muestre al
    // instante (la lectura en vivo de los canales es lo que tarda).
    await cx.supabase
      .from("reconciliacion_snapshots")
      .upsert({ id: "actual", resumen, creado_en: creadoEn });
    revalidatePath("/inventario");
    return { ok: true, resumen, creadoEn };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falló la revisión de inventario." };
  }
}

/* Reconciliación manual con Mercado Libre (botón del panel). */
export async function sincronizarMercadolibre(): Promise<{ ok: true; detalle: string } | { error: string }> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede sincronizar el inventario.");
  if ("error" in cx) return cx;

  try {
    const r = await conActor(cx.user.id, () => importacionCompletaML());
    revalidatePath("/inventario");
    return {
      ok: true,
      detalle: `Sincronizado: ${r.items} publicaciones (${r.creados} nuevas, ${r.vinculados} vinculadas por SKU, ${r.actualizados} actualizadas${r.gemelas ? `, ${r.gemelas} gemelas de catálogo` : ""}${r.desactivados ? `, ${r.desactivados} desactivadas` : ""}).`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falló la sincronización con Mercado Libre." };
  }
}

/* Reconciliación manual con TikTok Shop (botón del panel). */
export async function sincronizarTiktok(): Promise<{ ok: true; detalle: string } | { error: string }> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede sincronizar el inventario.");
  if ("error" in cx) return cx;

  try {
    const r = await conActor(cx.user.id, () => importacionCompletaTikTok());
    revalidatePath("/inventario");
    return {
      ok: true,
      detalle: `Sincronizado: ${r.productos} productos (${r.creados} nuevos, ${r.vinculados} vinculados por SKU, ${r.actualizados} actualizados${r.desactivados ? `, ${r.desactivados} desactivados` : ""}${r.fotos_pobladas ? `, ${r.fotos_pobladas} fotos copiadas de Tienda Nube` : ""}).`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falló la sincronización con TikTok Shop." };
  }
}

/* Une dos fichas que resultaron ser el mismo artículo (publicación original +
   gemela de catálogo de ML, o una publicación suelta que comparte SKU con la
   ficha de Tienda Nube). El historial del perdedor —ventas, movimientos de
   stock, renglones de pedidos— pasa al ganador y su ficha se borra.

   El stock NO se suma: ambas venían reflejando el MISMO inventario físico. */
export async function fusionarProductosML(
  ganadorId: string,
  perdedorId: string,
): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede unir fichas.");
  if ("error" in cx) return cx;

  /* Antes de fusionar hay que mirar los vínculos: si el ganador viene de Tienda
     Nube y no tenía publicación de ML (el caso del mismo SKU), tiene que heredar
     la del perdedor. Si no, la próxima sync no reconocería esa publicación como
     ya importada y volvería a abrirle ficha propia. */
  const { data: fichas, error: errFichas } = await cx.supabase
    .from("products")
    .select("id, meli_item_id, meli_variation_id, meli_logistic_type, meli_user_product_id")
    .in("id", [ganadorId, perdedorId]);
  if (errFichas) return { error: errFichas.message };
  const ganador = fichas?.find((f) => f.id === ganadorId);
  const perdedor = fichas?.find((f) => f.id === perdedorId);

  const { error } = await cx.supabase.rpc("fusionar_producto_ml", {
    p_ganador: ganadorId,
    p_perdedor: perdedorId,
  });
  if (error) return { error: error.message };

  if (ganador && perdedor?.meli_item_id && ganador.meli_item_id == null) {
    const { error: errVinculo } = await cx.supabase
      .from("products")
      .update({
        meli_item_id: perdedor.meli_item_id,
        meli_variation_id: perdedor.meli_variation_id,
        meli_logistic_type: perdedor.meli_logistic_type,
      })
      .eq("id", ganadorId);
    if (errVinculo) {
      return {
        error: `Las fichas se unieron, pero no se pudo pasar la publicación de Mercado Libre: ${errVinculo.message}`,
      };
    }
  }

  revalidatePath("/inventario");
  return { ok: true };
}

/* ============================ Productos =================================== */

export async function guardarProducto(id: string | null, input: ProductoInput): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede gestionar el inventario.");
  if ("error" in cx) return cx;

  const nombre = input.nombre.trim();
  if (!nombre) return { error: "El producto necesita un nombre." };
  if (input.stock < 0 || input.stock_minimo < 0) return { error: "El stock no puede ser negativo." };

  const fila = {
    nombre,
    tipo: input.tipo,
    variante: textoONulo(input.variante),
    costo: input.costo,
    precio: input.precio,
    stock: input.stock,
    stock_minimo: input.stock_minimo,
    proveedor_id: input.proveedor_id,
    activo: input.activo,
    bajo_pedido: input.bajo_pedido,
    descontinuado: input.descontinuado,
    notas: textoONulo(input.notas),
  };

  const dinero = await vistaDinero();

  if (id) {
    // El inventario NO se administra desde el diálogo de edición: el stock solo
    // cambia con el ajuste manual +/− de la tabla (ajustarStock). Aquí, para
    // productos vinculados a un canal, se excluye `stock` del update (así
    // editar nombre/precio/notas nunca pisa el inventario). A Tienda Nube se le
    // empujan precio y costo si cambiaron, pero SOLO con la escritura a canales
    // habilitada: por defecto el CRM es solo lectura y no toca la tienda.
    const { data: actual, error: errActual } = await cx.supabase
      .from("products")
      .select("tiendanube_product_id, tiendanube_variant_id, meli_item_id, precio")
      .eq("id", id)
      .single();
    if (errActual) return { error: errActual.message };

    /* El costo anterior sale de `producto_costos`: la columna está fuera del
       alcance del token (ver 20260902000000). Solo hace falta para saber si
       cambió y avisar a Tienda Nube, así que ni se pide sin ese permiso. */
    const [{ costo: costoActual }] = await adjuntarCostos(
      cx.supabase,
      [{ id }],
      dinero.egresos,
    );
    const vinculado = actual.tiendanube_variant_id != null || actual.meli_item_id != null;

    /* Quien no ve el costo (o el precio) tampoco lo recibió al abrir la ficha,
       así que el formulario lo manda vacío: dejarlo pasar lo pondría en nulo sin
       que nadie lo pidiera. Se conserva el que ya tenía. Al dar de alta sí van
       —ahí el número lo pone quien captura—, y por eso esto solo pasa al editar. */
    const cambios: Record<string, unknown> = { ...fila };
    if (vinculado) delete cambios.stock;
    if (!dinero.egresos) delete cambios.costo;
    if (!dinero.ingresos) delete cambios.precio;

    const { error } = await cx.supabase.from("products").update(cambios).eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/inventario");

    // Sync inversa a Tienda Nube: SOLO precio/costo que hayan cambiado. Nunca stock.
    // Y solo los que esta persona podía ver: los otros ni se guardaron aquí, así
    // que compararlos daría un cambio inventado y empujaría un nulo a la tienda.
    const cambiosTN: { precio?: number | null; costo?: number | null } = {};
    if (dinero.ingresos && fila.precio !== actual.precio) cambiosTN.precio = fila.precio;
    if (dinero.egresos && fila.costo !== costoActual) cambiosTN.costo = fila.costo;
    if (ESCRITURA_CANALES && (cambiosTN.precio !== undefined || cambiosTN.costo !== undefined)) {
      try {
        await empujarProductoTN({
          tiendanube_product_id: actual.tiendanube_product_id,
          tiendanube_variant_id: actual.tiendanube_variant_id,
          ...cambiosTN,
        });
      } catch (e) {
        return {
          error: `Se guardó en el CRM, pero Tienda Nube: ${e instanceof Error ? e.message : "error desconocido"}`,
        };
      }
    }
    return { ok: true };
  }

  const { error } = await cx.supabase.from("products").insert({ ...fila, created_by: cx.user.id });
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

/* Ajuste rápido de stock desde la tabla (botones +/− o edición directa). */
export async function ajustarStock(id: string, stock: number): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede ajustar el stock.");
  if ("error" in cx) return cx;
  if (!Number.isInteger(stock) || stock < 0) return { error: "El stock debe ser un entero ≥ 0." };

  // Valor previo para el ledger (stock_log): éste es el ÚNICO camino manual que
  // toca el stock, así que se deja rastro explícito. Con la escritura a canales
  // apagada (el default) el ajuste es local: no viaja a Tienda Nube ni a ML.
  const { data: prev } = await cx.supabase.from("products").select("stock").eq("id", id).single();

  const { data, error } = await cx.supabase
    .from("products")
    .update({ stock })
    .eq("id", id)
    .select(
      "sku, bajo_pedido, tiendanube_product_id, tiendanube_variant_id, meli_item_id, meli_variation_id, meli_logistic_type, tiktok_product_id, tiktok_sku_id",
    )
    .single();
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  /* Todo lo que registre stock aquí dentro queda firmado con quien ajustó: es
     el único camino manual que toca el inventario y el que más se audita. */
  const errores = await conActor(cx.user.id, async () => {
    await registrarStockLog([
      { producto_id: id, canal: "crm", origen: "manual", stock_anterior: prev?.stock ?? null, stock_nuevo: stock },
    ]);
    /* Sync inversa: el ajuste viaja a los canales vinculados (no-op en solo
       lectura, que es el default). Va con el `delta` para que cada canal reciba el
       MOVIMIENTO —"suma 3"— y no un total que quizá ya no corresponde a lo que
       tiene: si alguien vendió entre nuestra lectura y nuestra escritura, sumar 3
       respeta esa venta; imponer el total la borraría. */
    return propagarStock("crm", [{ id, ...data, stock, delta: prev ? stock - prev.stock : null }]);
  });
  if (errores.length > 0) {
    return { error: `El stock se guardó en el CRM, pero: ${errores.join(" · ")}` };
  }
  return { ok: true };
}

export async function borrarProducto(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede borrar productos.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("products").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

/* Historial de UN producto, para el pop-up. Va aparte del que carga la página
   (los movimientos más recientes de todo el catálogo): filtrar esos por producto
   dejaría casi todas las fichas en blanco.

   Por defecto SIN las puestas al día: son el 93% del ledger, así que los últimos
   ocho renglones de una ficha eran casi siempre «igualado con el canal» y nunca
   se veía la venta ni la recepción que de verdad la movieron. */
export async function movimientosProducto(
  productoId: string,
  limite = 8,
  incluirPuestasAlDia = false,
): Promise<{ movimientos: StockLog[] } | { error: string }> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede ver el historial.");
  if ("error" in cx) return cx;

  let q = cx.supabase
    .from("stock_log")
    .select("*, autor:profiles!created_by(nombre)")
    .eq("producto_id", productoId);
  if (!incluirPuestasAlDia) q = q.not("origen", "in", FILTRO_PUESTA_AL_DIA);

  const { data, error } = await q.order("creado_en", { ascending: false }).limit(limite);
  if (error) return { error: error.message };
  return { movimientos: (data ?? []) as unknown as StockLog[] };
}

/* Historial de stock de la pantalla de Inventario, en sus dos vistas.
   La página ya trae la inicial (movimientos reales, todos los canales); esta
   acción sirve los cambios de vista y de canal.

   El filtro de canal va AQUÍ y no en el navegador a propósito: filtrar en el
   cliente sobre una lista ya recortada por el tope enseñaría tres renglones de
   Mercado Libre y daría a entender que solo hubo tres. */
export async function movimientosStock(opts: {
  vista: "reales" | "puestas_al_dia";
  canal?: "todos" | StockLog["canal"];
  limite?: number;
}): Promise<{ movimientos: StockLog[]; tope: boolean } | { error: string }> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede ver el historial.");
  if ("error" in cx) return cx;

  const limite =
    opts.limite ?? (opts.vista === "reales" ? LIMITE_MOVIMIENTOS : LIMITE_PUESTAS_AL_DIA);

  let q = cx.supabase
    .from("stock_log")
    .select("*, producto:products!producto_id(nombre, variante), autor:profiles!created_by(nombre)");
  q =
    opts.vista === "reales"
      ? q.not("origen", "in", FILTRO_PUESTA_AL_DIA)
      : q.in("origen", [...ORIGENES_PUESTA_AL_DIA]);
  if (opts.canal && opts.canal !== "todos") q = q.eq("canal", opts.canal);

  const { data, error } = await q.order("creado_en", { ascending: false }).limit(limite);
  if (error) return { error: error.message };
  const movimientos = (data ?? []) as unknown as StockLog[];
  // Con el tope alcanzado hay más historia detrás; la pantalla lo dice en vez de
  // aparentar que eso es todo lo que pasó.
  return { movimientos, tope: movimientos.length >= limite };
}

/* ========================= Fotos propias (Storage) ======================== */

const BUCKET_FOTOS = "fotos-productos";

/* Devuelve la foto creada para que el pop-up abierto la pinte al instante (sus
   props son una foto del producto anterior a la subida). */
export async function subirFotoProducto(
  productoId: string,
  formData: FormData,
): Promise<{ ok: true; foto: ProductPhoto } | { error: string }> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede subir fotos.");
  if ("error" in cx) return cx;

  const archivo = archivoDeFormData(formData, {
    maxMB: 10,
    soloImagenes: true,
    mensajeExcedido: "La imagen supera 10 MB.",
  });
  if ("error" in archivo) return archivo;
  const { file } = archivo;

  const path = rutaParaArchivo(productoId, file.name);

  const r = await subirYRegistrar<ProductPhoto>({
    supabase: cx.supabase,
    bucket: BUCKET_FOTOS,
    path,
    file,
    insertar: async () => {
      const { count } = await cx.supabase
        .from("product_photos")
        .select("id", { count: "exact", head: true })
        .eq("producto_id", productoId);
      return await cx.supabase
        .from("product_photos")
        .insert({
          producto_id: productoId,
          nombre: file.name,
          storage_path: path,
          tipo: file.type || null,
          orden: count ?? 0,
        })
        .select("*")
        .single();
    },
    errorRegistro: "No se pudo registrar la foto.",
  });
  if ("error" in r) return r;
  revalidatePath("/inventario");
  return { ok: true, foto: r.datos };
}

export async function borrarFotoProducto(id: string, storagePath: string): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede borrar fotos.");
  if ("error" in cx) return cx;

  const r = await borrarArchivoYFila({
    supabase: cx.supabase,
    bucket: BUCKET_FOTOS,
    path: storagePath,
    tabla: "product_photos",
    id,
  });
  if ("error" in r) return r;
  revalidatePath("/inventario");
  return { ok: true };
}

/* ============================ Conteo físico ============================== */

export type ConteoInput = {
  producto_id: string | null;
  descripcion: string;
  cantidad: number;
  contado_por: string;
  corroborado_por: string;
  nota: string;
  fecha: string;
};

export async function registrarConteo(input: ConteoInput): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede registrar conteos.");
  if ("error" in cx) return cx;
  if (!input.producto_id && !input.descripcion.trim())
    return { error: "Elige un producto o describe qué se contó." };
  if (!Number.isInteger(input.cantidad) || input.cantidad < 0)
    return { error: "La cantidad contada debe ser un entero ≥ 0." };

  const { error } = await cx.supabase.from("conteos_fisicos").insert({
    producto_id: input.producto_id,
    descripcion: textoONulo(input.descripcion),
    cantidad: input.cantidad,
    contado_por: textoONulo(input.contado_por),
    corroborado_por: textoONulo(input.corroborado_por),
    nota: textoONulo(input.nota),
    fecha: input.fecha || undefined,
    created_by: cx.user.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

export async function borrarConteo(id: string): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede borrar conteos.");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("conteos_fisicos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

/* Galería importada de los canales para UN producto. Va aparte del listado
   porque `products.imagenes` pesa ~950 KB sobre el catálogo completo y solo la
   necesita el diálogo de edición cuando se abre. */
export async function galeriaDeProducto(
  productoId: string,
): Promise<{ ok: true; imagenes: string[] } | { error: string }> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede ver el inventario.");
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase
    .from("products")
    .select("imagenes")
    .eq("id", productoId)
    .single();
  if (error) return { error: error.message };
  return { ok: true, imagenes: (data?.imagenes as string[] | null) ?? [] };
}

