"use server";

/* Acciones de recepción de mercancía (Bodega). Salieron del actions.ts único de 900
   líneas, que mezclaba cinco sub-dominios sin relación entre sí. El archivo
   viejo sigue existiendo como barril: re-exporta todo esto, así que ningún
   componente cambió de import. */

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { revalidar } from "@/app/(app)/bodega/acciones/comun";
import type {
  EstadoRecepcionId,
} from "@/lib/types";

/* ============================ Recepción de mercancía ====================== */

export type RecepcionInput = {
  titulo: string;
  canal: "tienda_nube" | "mercado_libre";
  pedido_proveedor_id: string | null;
  notas: string;
};

export async function guardarRecepcion(
  id: string | null,
  input: RecepcionInput,
): Promise<Resultado<{ id: string }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const titulo = input.titulo.trim();
  if (!titulo) return { error: "Ponle nombre a la carga (p. ej. «Carga 04/08 playeras»)." };

  const fila = {
    titulo,
    canal: input.canal,
    pedido_proveedor_id: input.pedido_proveedor_id,
    notas: textoONulo(input.notas),
  };

  const { data, error } = id
    ? await cx.supabase.from("recepciones_bodega").update(fila).eq("id", id).select("id").single()
    : await cx.supabase
        .from("recepciones_bodega")
        .insert({ ...fila, created_by: cx.user.id })
        .select("id")
        .single();

  if (error || !data) return { error: error?.message ?? "No se pudo guardar la carga." };
  revalidar();
  return { ok: true, datos: { id: data.id as string } };
}

export async function cerrarRecepcion(id: string, cerrar: boolean): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase
    .from("recepciones_bodega")
    .update({ estado: cerrar ? "cerrada" : "abierta", cerrada_en: cerrar ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarRecepcion(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección, administración o coordinación puede borrar una carga.");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("recepciones_bodega").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export type RecepcionItemInput = {
  sku: string;
  producto_id: string | null;
  unidades_no_procesadas: number;
  sku_consolidado: string | null;
  categoria: string | null;
  producto_nombre: string | null;
  talla: string | null;
  /* Lo que TENÍA que llegar según el pedido al proveedor; null = sin dato. */
  esperado: number | null;
  /* «2 llegaron maltratados»: la nota del renglón. */
  nota: string | null;
};

/* La fila tal como la guarda la tabla. La comparten el pegado en bloque y el
   alta de uno en uno para que un renglón capturado a mano quede idéntico a uno
   pegado: mismo recorte, mismo SKU en mayúsculas, mismas unidades enteras. */
function filaRecepcion(recepcionId: string, f: RecepcionItemInput) {
  return {
    recepcion_id: recepcionId,
    sku: f.sku.trim().toUpperCase(),
    producto_id: f.producto_id,
    unidades_no_procesadas: Math.max(0, Math.trunc(f.unidades_no_procesadas)),
    sku_consolidado: textoONulo(f.sku_consolidado ?? ""),
    categoria: textoONulo(f.categoria ?? ""),
    producto_nombre: textoONulo(f.producto_nombre ?? ""),
    talla: textoONulo(f.talla ?? ""),
    esperado:
      f.esperado !== null && Number.isFinite(f.esperado) ? Math.max(0, Math.trunc(f.esperado)) : null,
    nota: textoONulo(f.nota ?? ""),
  };
}

/* Alta en lote de los renglones pegados desde la plantilla de la hoja. */
export async function importarItemsRecepcion(
  recepcionId: string,
  filas: RecepcionItemInput[],
): Promise<Resultado<{ creados: number }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  if (!recepcionId) return { error: "Falta la carga a la que pertenecen los renglones." };

  const utiles = filas.filter((f) => f.sku.trim());
  if (!utiles.length) return { error: "No hay renglones con SKU para importar." };

  const { error } = await cx.supabase
    .from("recepcion_items")
    .insert(utiles.map((f) => filaRecepcion(recepcionId, f)));

  if (error) return { error: error.message };
  revalidar();
  return { ok: true, datos: { creados: utiles.length } };
}

/* Un renglón capturado a mano. Existe además del pegado porque la hoja no
   siempre alcanza: llega un SKU que no venía en la plantilla, o hay que
   registrar lo que trajo el proveedor de más. Nace en «traer», como los
   pegados: el estado lo mueve el piso. */
export async function agregarItemRecepcion(
  recepcionId: string,
  input: RecepcionItemInput,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  if (!recepcionId) return { error: "Falta la carga a la que pertenece el renglón." };
  if (!input.sku.trim()) return { error: "El renglón necesita su SKU." };
  if (!Number.isFinite(input.unidades_no_procesadas) || input.unidades_no_procesadas <= 0)
    return { error: "Las unidades tienen que ser más de cero." };

  const { error } = await cx.supabase
    .from("recepcion_items")
    .insert(filaRecepcion(recepcionId, input));
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Corregir un renglón ya capturado. Hasta ahora un SKU mal tecleado obligaba a
   borrar el renglón y volver a escribirlo entero, con su talla y sus unidades.

   OJO con los renglones ya DESCONTADOS: sus unidades ya se sumaron a
   `products.stock` y quedaron firmadas en el ledger (RPC descontar_recepcion,
   20260821000000). Cambiarlas aquí no deshace esa suma —la RPC es idempotente
   por estado y no vuelve a correr—, así que el stock quedaría diciendo una cosa
   y la carga otra. Por eso `producto_id` y `unidades_no_procesadas` se conservan
   tal como están en la base y solo se dejan corregir los datos descriptivos
   (SKU, talla, consolidado, nombre), que no mueven inventario.

   El candado va aquí y no solo en la pantalla: la acción es `interno` y
   cualquiera del equipo puede llamarla directo. */
export async function actualizarItemRecepcion(
  id: string,
  input: RecepcionItemInput,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  if (!input.sku.trim()) return { error: "El renglón necesita su SKU." };
  if (!Number.isFinite(input.unidades_no_procesadas) || input.unidades_no_procesadas <= 0)
    return { error: "Las unidades tienen que ser más de cero." };

  const { data: actual, error: errorLectura } = await cx.supabase
    .from("recepcion_items")
    .select("recepcion_id, estado, producto_id, unidades_no_procesadas")
    .eq("id", id)
    .single();
  if (errorLectura || !actual) {
    return { error: errorLectura?.message ?? "Ese renglón ya no está en la carga." };
  }

  const fila = filaRecepcion(actual.recepcion_id as string, input);
  const descontado = actual.estado === "descontado";
  const { recepcion_id: _sinTocar, ...campos } = fila;
  void _sinTocar; // la carga a la que pertenece no se mueve al editar

  const { error } = await cx.supabase
    .from("recepcion_items")
    .update(
      descontado
        ? {
            ...campos,
            producto_id: actual.producto_id,
            unidades_no_procesadas: actual.unidades_no_procesadas,
          }
        : campos,
    )
    .eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Mover un renglón por los estados de la hoja. «descontado» no se escribe a
   mano: pasa por la RPC, que suma el stock y deja rastro una sola vez. */
export async function cambiarEstadoItem(
  id: string,
  estado: EstadoRecepcionId,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  if (estado === "descontado") {
    const { error } = await cx.supabase.rpc("descontar_recepcion", { iid: id });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true };
  }

  const { error } = await cx.supabase.from("recepcion_items").update({ estado }).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Descontar de golpe lo que ya está checado: es el paso final de una carga y
   hacerlo renglón por renglón con 200 SKUs no es viable en el piso. El recorrido
   vive en la base (descontar_recepcion_lote), así que es UN viaje a Supabase en
   vez de uno por renglón, y además todo o nada: si un renglón truena, no queda
   media carga sumada al stock. */
export async function descontarChecados(
  recepcionId: string,
): Promise<Resultado<{ descontados: number }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase.rpc("descontar_recepcion_lote", {
    rid: recepcionId,
  });
  if (error) return { error: error.message };

  revalidar();
  return { ok: true, datos: { descontados: Number(data ?? 0) } };
}

export async function borrarItemRecepcion(id: string): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("recepcion_items").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}
