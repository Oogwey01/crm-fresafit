"use server";

import { revalidatePath } from "next/cache";
import { invalidar, TAGS } from "@/lib/supabase/cache";
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
import { extraerFacturaConIA, type FacturaExtraida } from "@/lib/facturas/extraer";
import type { EstadoPedidoProvId, PedidoProvDetalle } from "@/lib/types";

/* A quién le compramos y qué le pedimos.

   Todo el módulo es de DIRECCIÓN: lleva costos de compra, condiciones de
   proveedor y los pagos de cada pedido. Ni administración entra. Cada action
   pasa por exigirRol("direccion") con este mismo mensaje.

   Recibir un pedido «sumando stock» sí toca el inventario, así que las dos
   rutas se revalidan juntas. */
const NO_AUTORIZADO = "Solo Dirección puede ver y mover los proveedores.";

const RUTAS = ["/proveedores", "/inventario"];

function revalidar() {
  for (const r of RUTAS) revalidatePath(r);
  /* La lista de proveedores está cacheada entre requests (lib/supabase/cache). */
  invalidar(TAGS.proveedores);
}

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


/* ============================ Proveedores ================================= */

export async function guardarProveedor(id: string | null, input: ProveedorInput): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
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
  revalidar();
  return { ok: true };
}

export async function borrarProveedor(id: string): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("suppliers").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
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
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
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
  /* Los renglones de una edición se reemplazan por el conjunto nuevo. Se
     apuntan los viejos para borrarlos DESPUÉS de insertar los nuevos: al revés
     —borrar y luego insertar—, un fallo entre las dos sentencias dejaba el
     pedido sin ningún renglón. Así lo peor es que se vean duplicados, que salta
     a la vista y se arregla volviendo a guardar. */
  let viejos: string[] = [];
  if (id) {
    /* El update del pedido y la lectura de sus renglones no dependen entre sí. */
    const [actualizado, previos] = await Promise.all([
      cx.supabase.from("supplier_orders").update(fila).eq("id", id),
      cx.supabase.from("supplier_order_items").select("id").eq("pedido_id", id),
    ]);
    if (actualizado.error) return { error: actualizado.error.message };
    if (previos.error) return { error: previos.error.message };
    viejos = (previos.data ?? []).map((r) => r.id as string);
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

  if (viejos.length) {
    const { error: podaErr } = await cx.supabase
      .from("supplier_order_items")
      .delete()
      .in("id", viejos);
    if (podaErr) return { error: podaErr.message };
  }

  revalidar();
  return { ok: true };
}

/* Cambio rápido de estado desde la tabla (sin pasar por "recibido"; para eso
   está recibirPedidoProv, que pregunta por el stock). */
export async function cambiarEstadoPedidoProv(id: string, estado: EstadoPedidoProvId): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("supplier_orders").update({ estado }).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Marcar recibido; si sumarStock, los renglones con producto suman al stock.
   Atómico vía la función recibir_pedido_proveedor (migración 20250103). */
export async function recibirPedidoProv(id: string, sumarStock: boolean): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.rpc("recibir_pedido_proveedor", {
    pid: id,
    sumar_stock: sumarStock,
  });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarPedidoProv(id: string): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("supplier_orders").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* ========== Seguimiento del pedido: pagos e incidencias ================== */

const BUCKET_PEDIDOS = "pedidos-proveedor";

/* Carga los pagos y las incidencias de un pedido (para el diálogo). */
/* Lanza si alguna consulta falla: antes un error de RLS o de red se devolvía
   como listas vacías y el pedido se veía "sin pagos ni incidencias". */
export async function cargarDetallePedido(pedidoId: string): Promise<PedidoProvDetalle> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) throw new Error(cx.error);
  const [pagos, incidencias] = await Promise.all([
    cx.supabase.from("supplier_order_payments").select("*").eq("pedido_id", pedidoId).order("fecha", { ascending: true }),
    cx.supabase.from("supplier_order_incidents").select("*").eq("pedido_id", pedidoId).order("created_at", { ascending: false }),
  ]);
  const fallo = [pagos, incidencias].find((r) => r.error);
  if (fallo?.error) throw new Error(fallo.error.message);
  return { pagos: pagos.data ?? [], incidencias: incidencias.data ?? [] };
}

/* Registra un pago del pedido, con comprobante opcional (imagen/PDF). */
export async function registrarPagoPedido(
  pedidoId: string,
  formData: FormData,
): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
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
  revalidar();
  return { ok: true };
}

export async function borrarPagoPedido(id: string, comprobantePath: string | null): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
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
  revalidar();
  return { ok: true };
}

/* URL firmada temporal (1 h) para ver/descargar un comprobante de pago. */
export async function urlComprobantePedido(
  storagePath: string,
): Promise<{ url: string } | { error: string }> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;
  return urlFirmada(cx.supabase, BUCKET_PEDIDOS, storagePath);
}

export async function agregarIncidenciaPedido(pedidoId: string, texto: string): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;
  const t = texto.trim();
  if (!t) return { error: "La incidencia está vacía." };
  const { error } = await cx.supabase
    .from("supplier_order_incidents")
    .insert({ pedido_id: pedidoId, texto: t, created_by: cx.user.id });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function resolverIncidenciaPedido(id: string, resuelto: boolean): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("supplier_order_incidents").update({ resuelto }).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarIncidenciaPedido(id: string): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("supplier_order_incidents").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}


/* ============================ Facturas de proveedor (IA) ================== */

/* Lee la factura del proveedor y devuelve sus partidas para prellenar un
   pedido. Lo pidió René: la factura llega en dólares y hoy se recaptura a mano
   renglón por renglón. NO guarda nada — el usuario revisa la vista previa y es
   quien decide; si la lectura falla, siempre puede capturar el pedido a mano. */
export async function extraerFactura(
  formData: FormData,
): Promise<Resultado<FacturaExtraida>> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  const archivo = archivoDeFormData(formData, {
    maxMB: 20,
    mensajeExcedido: "La factura supera 20 MB. Mándala en páginas separadas.",
  });
  if ("error" in archivo) return archivo;

  const r = await extraerFacturaConIA(archivo.file);
  if ("error" in r) return r;
  return { ok: true, datos: r.datos };
}
