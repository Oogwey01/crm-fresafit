"use server";

import { revalidatePath } from "next/cache";
import { usuarioActual, esInterno } from "@/lib/supabase/usuario-actual";
import { esGestor } from "@/lib/catalogos";
import { empujarProductoTN, sincronizacionCompleta } from "@/lib/tiendanube/sync";
import { importacionCompletaML } from "@/lib/mercadolibre/sync";
import { propagarStock } from "@/lib/inventario/stock-hub";
import type { EstadoPedidoProvId, TipoProductoId } from "@/lib/types";

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
  notas: string;
};

export type ProveedorInput = {
  nombre: string;
  telefono: string;
  correo: string;
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
      detalle: `Sincronizado: ${r.items} publicaciones (${r.creados} nuevas, ${r.vinculados} vinculadas por SKU, ${r.actualizados} actualizadas${r.desactivados ? `, ${r.desactivados} desactivadas` : ""}).`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falló la sincronización con Mercado Libre." };
  }
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
    notas: input.notas.trim() || null,
  };

  if (id) {
    const { data, error } = await supabase
      .from("products")
      .update(fila)
      .eq("id", id)
      .select("tiendanube_product_id, tiendanube_variant_id, meli_item_id, meli_variation_id")
      .single();
    if (error) return { error: error.message };
    revalidatePath("/inventario");
    // Sync inversa: Tienda Nube recibe stock/precio/costo; Mercado Libre solo
    // stock (los precios de ML se administran allá). Origen "tiendanube" en el
    // hub = no reenviar a TN, que ya quedó completa con empujarProductoTN.
    const avisos: string[] = [];
    try {
      await empujarProductoTN({ ...data, stock: fila.stock, precio: fila.precio, costo: fila.costo });
    } catch (e) {
      avisos.push(`Tienda Nube: ${e instanceof Error ? e.message : "error desconocido"}`);
    }
    avisos.push(...(await propagarStock("tiendanube", [{ ...data, stock: fila.stock }])));
    if (avisos.length > 0) {
      return { error: `Se guardó en el CRM, pero: ${avisos.join(" · ")}` };
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

  const { data, error } = await supabase
    .from("products")
    .update({ stock })
    .eq("id", id)
    .select("tiendanube_product_id, tiendanube_variant_id, meli_item_id, meli_variation_id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/inventario");
  // Sync inversa: el ajuste rápido viaja a todos los canales vinculados.
  const errores = await propagarStock("crm", [{ ...data, stock }]);
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

/* ============================ Proveedores ================================= */

export async function guardarProveedor(id: string | null, input: ProveedorInput): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede gestionar proveedores." };

  const nombre = input.nombre.trim();
  if (!nombre) return { error: "El proveedor necesita un nombre." };

  const fila = {
    nombre,
    telefono: input.telefono.trim() || null,
    correo: input.correo.trim() || null,
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
