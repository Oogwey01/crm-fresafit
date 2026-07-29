"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual, esInterno } from "@/lib/supabase/usuario-actual";
import { esGestor } from "@/lib/catalogos";
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

type Resultado = { ok: true } | { error: string };

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
  const { user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede sincronizar el inventario." };

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
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede revisar el inventario." };

  try {
    const resumen = await reconciliarInventario();
    const creadoEn = new Date().toISOString();
    // Se guarda el resultado para que la próxima carga del panel lo muestre al
    // instante (la lectura en vivo de los canales es lo que tarda).
    await supabase
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
  const { user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede sincronizar el inventario." };

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
  const { user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede sincronizar el inventario." };

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
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede unir fichas." };

  /* Antes de fusionar hay que mirar los vínculos: si el ganador viene de Tienda
     Nube y no tenía publicación de ML (el caso del mismo SKU), tiene que heredar
     la del perdedor. Si no, la próxima sync no reconocería esa publicación como
     ya importada y volvería a abrirle ficha propia. */
  const { data: fichas, error: errFichas } = await supabase
    .from("products")
    .select("id, meli_item_id, meli_variation_id, meli_logistic_type, meli_user_product_id")
    .in("id", [ganadorId, perdedorId]);
  if (errFichas) return { error: errFichas.message };
  const ganador = fichas?.find((f) => f.id === ganadorId);
  const perdedor = fichas?.find((f) => f.id === perdedorId);

  const { error } = await supabase.rpc("fusionar_producto_ml", {
    p_ganador: ganadorId,
    p_perdedor: perdedorId,
  });
  if (error) return { error: error.message };

  if (ganador && perdedor?.meli_item_id && ganador.meli_item_id == null) {
    const { error: errVinculo } = await supabase
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
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede gestionar el inventario." };

  const nombre = input.nombre.trim();
  if (!nombre) return { error: "El producto necesita un nombre." };
  if (input.stock < 0 || input.stock_minimo < 0) return { error: "El stock no puede ser negativo." };

  const fila = {
    nombre,
    tipo: input.tipo,
    variante: input.variante.trim() || null,
    costo: input.costo,
    precio: input.precio,
    stock: input.stock,
    stock_minimo: input.stock_minimo,
    proveedor_id: input.proveedor_id,
    activo: input.activo,
    bajo_pedido: input.bajo_pedido,
    descontinuado: input.descontinuado,
    notas: input.notas.trim() || null,
  };

  if (id) {
    // El inventario NO se administra desde el diálogo de edición: el stock solo
    // cambia con el ajuste manual +/− de la tabla (ajustarStock). Aquí, para
    // productos vinculados a un canal, se excluye `stock` del update (así
    // editar nombre/precio/notas nunca pisa el inventario). A Tienda Nube se le
    // empujan precio y costo si cambiaron, pero SOLO con la escritura a canales
    // habilitada: por defecto el CRM es solo lectura y no toca la tienda.
    const { data: actual, error: errActual } = await supabase
      .from("products")
      .select("tiendanube_product_id, tiendanube_variant_id, meli_item_id, precio, costo")
      .eq("id", id)
      .single();
    if (errActual) return { error: errActual.message };
    const vinculado = actual.tiendanube_variant_id != null || actual.meli_item_id != null;

    const filaSinStock: Record<string, unknown> = { ...fila };
    delete filaSinStock.stock;
    const { error } = await supabase
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

  const { error } = await supabase.from("products").insert({ ...fila, created_by: user.id });
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

/* Ajuste rápido de stock desde la tabla (botones +/− o edición directa). */
export async function ajustarStock(id: string, stock: number): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede ajustar el stock." };
  if (!Number.isInteger(stock) || stock < 0) return { error: "El stock debe ser un entero ≥ 0." };

  // Valor previo para el ledger (stock_log): éste es el ÚNICO camino manual que
  // toca el stock, así que se deja rastro explícito. Con la escritura a canales
  // apagada (el default) el ajuste es local: no viaja a Tienda Nube ni a ML.
  const { data: prev } = await supabase.from("products").select("stock").eq("id", id).single();

  const { data, error } = await supabase
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
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede borrar productos." };

  const { error } = await supabase.from("products").delete().eq("id", id);
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
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede ver el historial." };

  const { data, error } = await supabase
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
const MAX_FOTO = 10 * 1024 * 1024;

/* Devuelve la foto creada para que el pop-up abierto la pinte al instante (sus
   props son una foto del producto anterior a la subida). */
export async function subirFotoProducto(
  productoId: string,
  formData: FormData,
): Promise<{ ok: true; foto: ProductPhoto } | { error: string }> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede subir fotos." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No se recibió el archivo." };
  if (!file.type.startsWith("image/")) return { error: "El archivo debe ser una imagen." };
  if (file.size > MAX_FOTO) return { error: "La imagen supera 10 MB." };

  const limpio = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${productoId}/${Date.now()}-${limpio}`;

  const { error: upErr } = await supabase.storage.from(BUCKET_FOTOS).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (upErr) return { error: upErr.message };

  const { count } = await supabase
    .from("product_photos")
    .select("id", { count: "exact", head: true })
    .eq("producto_id", productoId);

  const { data, error } = await supabase
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
  if (error || !data) {
    // El binario ya subió pero no se registró: no dejar basura en Storage.
    await supabase.storage.from(BUCKET_FOTOS).remove([path]);
    return { error: error?.message ?? "No se pudo registrar la foto." };
  }
  revalidatePath("/inventario");
  return { ok: true, foto: data as ProductPhoto };
}

export async function borrarFotoProducto(id: string, storagePath: string): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede borrar fotos." };

  await supabase.storage.from(BUCKET_FOTOS).remove([storagePath]);
  const { error } = await supabase.from("product_photos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

/* ============================ Proveedores ================================= */

export async function guardarProveedor(id: string | null, input: ProveedorInput): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede gestionar proveedores." };

  const nombre = input.nombre.trim();
  if (!nombre) return { error: "El proveedor necesita un nombre." };
  if (input.dias_entrega !== null && (!Number.isInteger(input.dias_entrega) || input.dias_entrega < 0))
    return { error: "Los días de entrega deben ser un entero ≥ 0." };

  const fila = {
    nombre,
    telefono: input.telefono.trim() || null,
    correo: input.correo.trim() || null,
    pais: input.pais.trim() || null,
    contacto: input.contacto.trim() || null,
    dias_entrega: input.dias_entrega,
    notas: input.notas.trim() || null,
  };

  const { error } = id
    ? await supabase.from("suppliers").update(fila).eq("id", id)
    : await supabase.from("suppliers").insert({ ...fila, created_by: user.id });

  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

export async function borrarProveedor(id: string): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede borrar proveedores." };

  const { error } = await supabase.from("suppliers").delete().eq("id", id);
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
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede gestionar pedidos a proveedor." };

  const invalido = validarPedido(input);
  if (invalido) return { error: invalido };

  const fila = {
    proveedor_id: input.proveedor_id,
    fecha_pedido: input.fecha_pedido,
    fecha_estimada: input.fecha_estimada || null,
    estado: input.estado,
    costo_total: input.costo_total,
    paqueteria: input.paqueteria.trim() || null,
    num_guia: input.num_guia.trim() || null,
    url_rastreo: input.url_rastreo.trim() || null,
    notas: input.notas.trim() || null,
  };

  let pedidoId = id;
  if (id) {
    const { error } = await supabase.from("supplier_orders").update(fila).eq("id", id);
    if (error) return { error: error.message };
    // Los renglones se reemplazan por el conjunto nuevo (edición simple).
    const { error: delErr } = await supabase.from("supplier_order_items").delete().eq("pedido_id", id);
    if (delErr) return { error: delErr.message };
  } else {
    const { data, error } = await supabase
      .from("supplier_orders")
      .insert({ ...fila, created_by: user.id })
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
      descripcion: i.descripcion.trim() || null,
      cantidad: i.cantidad,
      costo_unitario: i.costo_unitario,
    }));
  const { error: itemsErr } = await supabase.from("supplier_order_items").insert(items);
  if (itemsErr) return { error: itemsErr.message };

  revalidatePath("/inventario");
  return { ok: true };
}

/* Cambio rápido de estado desde la tabla (sin pasar por "recibido"; para eso
   está recibirPedidoProv, que pregunta por el stock). */
export async function cambiarEstadoPedidoProv(id: string, estado: EstadoPedidoProvId): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede actualizar pedidos." };

  const { error } = await supabase.from("supplier_orders").update({ estado }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

/* Marcar recibido; si sumarStock, los renglones con producto suman al stock.
   Atómico vía la función recibir_pedido_proveedor (migración 20250103). */
export async function recibirPedidoProv(id: string, sumarStock: boolean): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede recibir pedidos." };

  const { error } = await supabase.rpc("recibir_pedido_proveedor", {
    pid: id,
    sumar_stock: sumarStock,
  });
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

export async function borrarPedidoProv(id: string): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede borrar pedidos." };

  const { error } = await supabase.from("supplier_orders").delete().eq("id", id);
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
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede registrar pagos." };

  const monto = Number(formData.get("monto"));
  if (!Number.isFinite(monto) || monto < 0) return { error: "El monto no es válido." };
  const fecha = String(formData.get("fecha") || "").trim() || null;
  const nota = String(formData.get("nota") || "").trim() || null;

  // Comprobante opcional: se sube primero; si falla el insert, se limpia.
  let comprobante: { path: string; nombre: string; tipo: string | null } | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) return { error: "El comprobante supera 10 MB." };
    const limpio = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${pedidoId}/${Date.now()}-${limpio}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET_PEDIDOS)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) return { error: upErr.message };
    comprobante = { path, nombre: file.name, tipo: file.type || null };
  }

  const { error } = await supabase.from("supplier_order_payments").insert({
    pedido_id: pedidoId,
    fecha,
    monto,
    nota,
    comprobante_path: comprobante?.path ?? null,
    comprobante_nombre: comprobante?.nombre ?? null,
    comprobante_tipo: comprobante?.tipo ?? null,
    created_by: user.id,
  });
  if (error) {
    if (comprobante) await supabase.storage.from(BUCKET_PEDIDOS).remove([comprobante.path]);
    return { error: error.message };
  }
  revalidatePath("/inventario");
  return { ok: true };
}

export async function borrarPagoPedido(id: string, comprobantePath: string | null): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede borrar pagos." };
  if (comprobantePath) await supabase.storage.from(BUCKET_PEDIDOS).remove([comprobantePath]);
  const { error } = await supabase.from("supplier_order_payments").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

/* URL firmada temporal (1 h) para ver/descargar un comprobante de pago. */
export async function urlComprobantePedido(
  storagePath: string,
): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET_PEDIDOS)
    .createSignedUrl(storagePath, 60 * 60);
  if (error || !data) return { error: error?.message ?? "No se pudo generar el enlace." };
  return { url: data.signedUrl };
}

export async function agregarIncidenciaPedido(pedidoId: string, texto: string): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede registrar incidencias." };
  const t = texto.trim();
  if (!t) return { error: "La incidencia está vacía." };
  const { error } = await supabase
    .from("supplier_order_incidents")
    .insert({ pedido_id: pedidoId, texto: t, created_by: user.id });
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

export async function resolverIncidenciaPedido(id: string, resuelto: boolean): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede actualizar incidencias." };
  const { error } = await supabase.from("supplier_order_incidents").update({ resuelto }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

export async function borrarIncidenciaPedido(id: string): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede borrar incidencias." };
  const { error } = await supabase.from("supplier_order_incidents").delete().eq("id", id);
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
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede registrar conteos." };
  if (!input.producto_id && !input.descripcion.trim())
    return { error: "Elige un producto o describe qué se contó." };
  if (!Number.isInteger(input.cantidad) || input.cantidad < 0)
    return { error: "La cantidad contada debe ser un entero ≥ 0." };

  const { error } = await supabase.from("conteos_fisicos").insert({
    producto_id: input.producto_id,
    descripcion: input.descripcion.trim() || null,
    cantidad: input.cantidad,
    contado_por: input.contado_por.trim() || null,
    corroborado_por: input.corroborado_por.trim() || null,
    nota: input.nota.trim() || null,
    fecha: input.fecha || undefined,
    created_by: user.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}

export async function borrarConteo(id: string): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede borrar conteos." };
  const { error } = await supabase.from("conteos_fisicos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  return { ok: true };
}
