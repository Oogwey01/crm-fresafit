"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { exigirRol } from "@/lib/supabase/guardia";
import {
  archivoDeFormData,
  rutaParaArchivo,
  subirYRegistrar,
  borrarArchivoYFila,
  urlFirmada,
} from "@/lib/storage";
import { textoONulo } from "@/lib/validacion";
import type { Resultado } from "@/lib/acciones";
import { empujarProductoTN, sincronizacionCompleta } from "@/lib/tiendanube/sync";
import { importacionCompletaML } from "@/lib/mercadolibre/sync";
import { importacionCompletaTikTok } from "@/lib/tiktok/sync";
import { propagarStock } from "@/lib/inventario/stock-hub";
import { registrarStockLog } from "@/lib/inventario/stock-log";
import { reconciliarInventario, type ResumenReconciliacion } from "@/lib/inventario/reconciliacion";
import { ESCRITURA_CANALES } from "@/lib/inventario/escritura-canales";
import type {
  EstadoPedidoProvId,
  PedidoProvDetalle,
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

export type ProveedorInput = {
  nombre: string;
  telefono: string;
  correo: string;
  pais: string;
  contacto: string;
  /* Días que tarda en llegar un pedido de este proveedor (null = default global
     del reabastecimiento). */
  dias_entrega: number | null;
  notas: string;
};

export type PedidoProvItemInput = {
  producto_id: string | null;
  descripcion: string;
  cantidad: number;
  costo_unitario: number | null;
};

export type PedidoProvInput = {
  proveedor_id: string;
  fecha_pedido: string;
  fecha_estimada: string | null;
  estado: EstadoPedidoProvId;
  costo_total: number | null;
  paqueteria: string;
  num_guia: string;
  url_rastreo: string;
  notas: string;
  items: PedidoProvItemInput[];
};

/* ============================ Tienda Nube ================================= */

/* Reconciliación manual con el catálogo de Tienda Nube (botón del panel).
   La importación automática corre por webhooks + cron; esto es el respaldo. */
export async function sincronizarTiendanube(): Promise<{ ok: true; detalle: string } | { error: string }> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede sincronizar el inventario.");
  if ("error" in cx) return cx;

  try {
    const r = await sincronizacionCompleta();
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
    const r = await importacionCompletaML();
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
    const r = await importacionCompletaTikTok();
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

  if (id) {
    // El inventario NO se administra desde el diálogo de edición: el stock solo
    // cambia con el ajuste manual +/− de la tabla (ajustarStock). Aquí, para
    // productos vinculados a un canal, se excluye `stock` del update (así
    // editar nombre/precio/notas nunca pisa el inventario). A Tienda Nube se le
    // empujan precio y costo si cambiaron, pero SOLO con la escritura a canales
    // habilitada: por defecto el CRM es solo lectura y no toca la tienda.
    const { data: actual, error: errActual } = await cx.supabase
      .from("products")
      .select("tiendanube_product_id, tiendanube_variant_id, meli_item_id, precio, costo")
      .eq("id", id)
      .single();
    if (errActual) return { error: errActual.message };
    const vinculado = actual.tiendanube_variant_id != null || actual.meli_item_id != null;

    const filaSinStock: Record<string, unknown> = { ...fila };
    delete filaSinStock.stock;
    const { error } = await cx.supabase
      .from("products")
      .update(vinculado ? filaSinStock : fila)
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/inventario");

    // Sync inversa a Tienda Nube: SOLO precio/costo que hayan cambiado. Nunca stock.
    const cambiosTN: { precio?: number | null; costo?: number | null } = {};
    if (fila.precio !== actual.precio) cambiosTN.precio = fila.precio;
    if (fila.costo !== actual.costo) cambiosTN.costo = fila.costo;
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
  await registrarStockLog([
    { producto_id: id, canal: "crm", origen: "manual", stock_anterior: prev?.stock ?? null, stock_nuevo: stock },
  ]);
  /* Sync inversa: el ajuste viaja a los canales vinculados (no-op en solo
     lectura, que es el default). Va con el `delta` para que cada canal reciba el
     MOVIMIENTO —"suma 3"— y no un total que quizá ya no corresponde a lo que
     tiene: si alguien vendió entre nuestra lectura y nuestra escritura, sumar 3
     respeta esa venta; imponer el total la borraría. */
  const errores = await propagarStock("crm", [
    { id, ...data, stock, delta: prev ? stock - prev.stock : null },
  ]);
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
   (los 300 movimientos más recientes de todo el catálogo): filtrar esos por
   producto dejaría casi todas las fichas en blanco. */
export async function movimientosProducto(
  productoId: string,
  limite = 8,
): Promise<{ movimientos: StockLog[] } | { error: string }> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede ver el historial.");
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase
    .from("stock_log")
    .select("*")
    .eq("producto_id", productoId)
    .order("creado_en", { ascending: false })
    .limit(limite);
  if (error) return { error: error.message };
  return { movimientos: (data ?? []) as unknown as StockLog[] };
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

/* ============================ Proveedores ================================= */

export async function guardarProveedor(id: string | null, input: ProveedorInput): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede gestionar proveedores.");
  if ("error" in cx) return cx;

  const nombre = input.nombre.trim();
  if (!nombre) return { error: "El proveedor necesita un nombre." };
  if (input.dias_entrega !== null && (!Number.isInteger(input.dias_entrega) || input.dias_entrega < 0))
    return { error: "Los días de entrega deben ser un entero ≥ 0." };

  const fila = {
    nombre,
    telefono: textoONulo(input.telefono),
    correo: textoONulo(input.correo),
    pais: textoONulo(input.pais),
    contacto: textoONulo(input.contacto),
    dias_entrega: input.dias_entrega,
    notas: textoONulo(input.notas),
  };

  const { error } = id
    ? await cx.supabase.from("suppliers").update(fila).eq("id", id)
    : await cx.supabase.from("suppliers").insert({ ...fila, created_by: cx.user.id });

  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

export async function borrarProveedor(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede borrar proveedores.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("suppliers").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

/* ============================ Pedidos a proveedor ========================= */

function validarPedido(input: PedidoProvInput): string | null {
  if (!input.proveedor_id) return "Elige el proveedor del pedido.";
  if (!input.fecha_pedido) return "Falta la fecha del pedido.";
  const items = input.items.filter((i) => i.producto_id || i.descripcion.trim());
  if (items.length === 0) return "Agrega al menos un producto al pedido.";
  if (items.some((i) => !Number.isInteger(i.cantidad) || i.cantidad <= 0))
    return "Cada renglón necesita una cantidad mayor a cero.";
  return null;
}

export async function guardarPedidoProv(id: string | null, input: PedidoProvInput): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede gestionar pedidos a proveedor.");
  if ("error" in cx) return cx;

  const invalido = validarPedido(input);
  if (invalido) return { error: invalido };

  const fila = {
    proveedor_id: input.proveedor_id,
    fecha_pedido: input.fecha_pedido,
    fecha_estimada: input.fecha_estimada || null,
    estado: input.estado,
    costo_total: input.costo_total,
    paqueteria: textoONulo(input.paqueteria),
    num_guia: textoONulo(input.num_guia),
    url_rastreo: textoONulo(input.url_rastreo),
    notas: textoONulo(input.notas),
  };

  let pedidoId = id;
  if (id) {
    const { error } = await cx.supabase.from("supplier_orders").update(fila).eq("id", id);
    if (error) return { error: error.message };
    // Los renglones se reemplazan por el conjunto nuevo (edición simple).
    const { error: delErr } = await cx.supabase.from("supplier_order_items").delete().eq("pedido_id", id);
    if (delErr) return { error: delErr.message };
  } else {
    const { data, error } = await cx.supabase
      .from("supplier_orders")
      .insert({ ...fila, created_by: cx.user.id })
      .select("id")
      .single();
    if (error || !data) return { error: error?.message ?? "No se pudo crear el pedido." };
    pedidoId = data.id;
  }

  const items = input.items
    .filter((i) => i.producto_id || i.descripcion.trim())
    .map((i) => ({
      pedido_id: pedidoId,
      producto_id: i.producto_id,
      descripcion: textoONulo(i.descripcion),
      cantidad: i.cantidad,
      costo_unitario: i.costo_unitario,
    }));
  const { error: itemsErr } = await cx.supabase.from("supplier_order_items").insert(items);
  if (itemsErr) return { error: itemsErr.message };

  revalidatePath("/inventario");
  return { ok: true };
}

/* Cambio rápido de estado desde la tabla (sin pasar por "recibido"; para eso
   está recibirPedidoProv, que pregunta por el stock). */
export async function cambiarEstadoPedidoProv(id: string, estado: EstadoPedidoProvId): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede actualizar pedidos.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("supplier_orders").update({ estado }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

/* Marcar recibido; si sumarStock, los renglones con producto suman al stock.
   Atómico vía la función recibir_pedido_proveedor (migración 20250103). */
export async function recibirPedidoProv(id: string, sumarStock: boolean): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede recibir pedidos.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.rpc("recibir_pedido_proveedor", {
    pid: id,
    sumar_stock: sumarStock,
  });
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

export async function borrarPedidoProv(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede borrar pedidos.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("supplier_orders").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

/* ========== Seguimiento del pedido: pagos e incidencias ================== */

const BUCKET_PEDIDOS = "pedidos-proveedor";

/* Carga los pagos y las incidencias de un pedido (para el diálogo). */
export async function cargarDetallePedido(pedidoId: string): Promise<PedidoProvDetalle> {
  const supabase = await createClient();
  const [pagos, incidencias] = await Promise.all([
    supabase.from("supplier_order_payments").select("*").eq("pedido_id", pedidoId).order("fecha", { ascending: true }),
    supabase.from("supplier_order_incidents").select("*").eq("pedido_id", pedidoId).order("created_at", { ascending: false }),
  ]);
  return { pagos: pagos.data ?? [], incidencias: incidencias.data ?? [] };
}

/* Registra un pago del pedido, con comprobante opcional (imagen/PDF). */
export async function registrarPagoPedido(
  pedidoId: string,
  formData: FormData,
): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede registrar pagos.");
  if ("error" in cx) return cx;

  const monto = Number(formData.get("monto"));
  if (!Number.isFinite(monto) || monto < 0) return { error: "El monto no es válido." };
  const fecha = textoONulo(String(formData.get("fecha") || ""));
  const nota = textoONulo(String(formData.get("nota") || ""));

  // Comprobante opcional: se sube primero; si falla el insert, se limpia.
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const archivo = archivoDeFormData(formData, {
      maxMB: 10,
      mensajeExcedido: "El comprobante supera 10 MB.",
    });
    if ("error" in archivo) return archivo;
    const path = rutaParaArchivo(pedidoId, archivo.file.name);
    const r = await subirYRegistrar({
      supabase: cx.supabase,
      bucket: BUCKET_PEDIDOS,
      path,
      file: archivo.file,
      insertar: () =>
        cx.supabase
          .from("supplier_order_payments")
          .insert({
            pedido_id: pedidoId,
            fecha,
            monto,
            nota,
            comprobante_path: path,
            comprobante_nombre: archivo.file.name,
            comprobante_tipo: archivo.file.type || null,
            created_by: cx.user.id,
          })
          .select("id")
          .single(),
      errorRegistro: "No se pudo registrar el pago.",
    });
    if ("error" in r) return r;
  } else {
    const { error } = await cx.supabase.from("supplier_order_payments").insert({
      pedido_id: pedidoId,
      fecha,
      monto,
      nota,
      comprobante_path: null,
      comprobante_nombre: null,
      comprobante_tipo: null,
      created_by: cx.user.id,
    });
    if (error) return { error: error.message };
  }
  revalidatePath("/inventario");
  return { ok: true };
}

export async function borrarPagoPedido(id: string, comprobantePath: string | null): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede borrar pagos.");
  if ("error" in cx) return cx;
  if (comprobantePath) {
    const r = await borrarArchivoYFila({
      supabase: cx.supabase,
      bucket: BUCKET_PEDIDOS,
      path: comprobantePath,
      tabla: "supplier_order_payments",
      id,
    });
    if ("error" in r) return r;
  } else {
    const { error } = await cx.supabase.from("supplier_order_payments").delete().eq("id", id);
    if (error) return { error: error.message };
  }
  revalidatePath("/inventario");
  return { ok: true };
}

/* URL firmada temporal (1 h) para ver/descargar un comprobante de pago. */
export async function urlComprobantePedido(
  storagePath: string,
): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();
  return urlFirmada(supabase, BUCKET_PEDIDOS, storagePath);
}

export async function agregarIncidenciaPedido(pedidoId: string, texto: string): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede registrar incidencias.");
  if ("error" in cx) return cx;
  const t = texto.trim();
  if (!t) return { error: "La incidencia está vacía." };
  const { error } = await cx.supabase
    .from("supplier_order_incidents")
    .insert({ pedido_id: pedidoId, texto: t, created_by: cx.user.id });
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

export async function resolverIncidenciaPedido(id: string, resuelto: boolean): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede actualizar incidencias.");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("supplier_order_incidents").update({ resuelto }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

export async function borrarIncidenciaPedido(id: string): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede borrar incidencias.");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("supplier_order_incidents").delete().eq("id", id);
  if (error) return { error: error.message };
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
