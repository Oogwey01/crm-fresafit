"use server";

/* Acciones de envíos a Mercado Full (Bodega). Salieron del actions.ts único de 900
   líneas, que mezclaba cinco sub-dominios sin relación entre sí. El archivo
   viejo sigue existiendo como barril: re-exporta todo esto, así que ningún
   componente cambió de import. */

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import type { TablesUpdate } from "@/lib/supabase/tipos-bd";
import { textoONulo } from "@/lib/validacion";
import { revalidar } from "@/app/(app)/bodega/acciones/comun";
import type {
  DestinoFullId,
  EstadoEnvioFullId,
} from "@/lib/types";

/* ============================ Envíos full ================================= */

export type EnvioFullInput = {
  destino: DestinoFullId;
  nombre: string;
  estado: EstadoEnvioFullId;
  fecha_envio: string | null;
  /* La guía: todo captura manual, tal como venía en la hoja. */
  id_plataforma: string;
  paqueteria: string;
  tipo_envio: string;
  num_guia: string;
  fecha_llegada_estimada: string | null;
  notas: string;
};

export async function guardarEnvioFull(
  id: string | null,
  input: EnvioFullInput,
): Promise<Resultado<{ id: string }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  if (!input.nombre.trim()) return { error: "Ponle nombre al envío." };

  const fila = {
    destino: input.destino,
    nombre: input.nombre.trim(),
    estado: input.estado,
    fecha_envio: input.fecha_envio,
    id_plataforma: textoONulo(input.id_plataforma),
    paqueteria: textoONulo(input.paqueteria),
    tipo_envio: textoONulo(input.tipo_envio),
    num_guia: textoONulo(input.num_guia),
    fecha_llegada_estimada: input.fecha_llegada_estimada,
    notas: textoONulo(input.notas),
  };

  const { data, error } = id
    ? await cx.supabase.from("envios_full").update(fila).eq("id", id).select("id").single()
    : await cx.supabase.from("envios_full").insert({ ...fila, created_by: cx.user.id }).select("id").single();

  if (error || !data) return { error: error?.message ?? "No se pudo guardar el envío." };
  revalidar();
  return { ok: true, datos: { id: data.id as string } };
}

export async function borrarEnvioFull(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección, administración o coordinación puede borrar un envío.");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("envios_full").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function agregarCajaFull(envioId: string): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const { data } = await cx.supabase
    .from("envio_full_cajas")
    .select("numero")
    .eq("envio_id", envioId)
    .order("numero", { ascending: false })
    .limit(1);
  const siguiente = ((data?.[0]?.numero as number) ?? 0) + 1;

  const { error } = await cx.supabase
    .from("envio_full_cajas")
    .insert({ envio_id: envioId, numero: siguiente });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Las medidas de la caja, cada una por su lado y en centímetros. Null = todavía
   no se mide; el cero es un valor válido (nadie lo va a capturar, pero si lo
   hace no hay razón para convertirlo en "sin dato"). */
export type MedidasCajaInput = {
  largo_cm: number | null;
  ancho_cm: number | null;
  alto_cm: number | null;
  peso_kg: number | null;
};

export async function guardarCajaFull(
  id: string,
  medidas: MedidasCajaInput,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  /* La BD las declara numeric(6,2) con check >= 0: se atajan aquí para que un
     dedazo devuelva una frase y no el error crudo de Postgres. */
  const valores = [medidas.largo_cm, medidas.ancho_cm, medidas.alto_cm, medidas.peso_kg];
  if (valores.some((v) => v !== null && (!Number.isFinite(v) || v < 0)))
    return { error: "Las medidas y el peso no pueden ir en negativo." };
  if (valores.some((v) => v !== null && v > 9999.99))
    return { error: "Revisa la medida: no cabe en el campo (máximo 9999.99)." };

  const { error } = await cx.supabase
    .from("envio_full_cajas")
    .update({
      largo_cm: medidas.largo_cm,
      ancho_cm: medidas.ancho_cm,
      alto_cm: medidas.alto_cm,
      peso_kg: medidas.peso_kg,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarCajaFull(id: string): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("envio_full_cajas").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export type ItemFullInput = {
  caja_id: string;
  producto_id: string | null;
  sku: string;
  asin: string;
  cantidad: number;
};

export async function agregarItemFull(input: ItemFullInput): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  if (!input.sku.trim()) return { error: "El renglón necesita su SKU." };
  if (!Number.isFinite(input.cantidad) || input.cantidad <= 0)
    return { error: "La cantidad tiene que ser mayor a cero." };

  const { error } = await cx.supabase.from("envio_full_items").insert({
    caja_id: input.caja_id,
    producto_id: input.producto_id,
    sku: input.sku.trim().toUpperCase(),
    asin: textoONulo(input.asin),
    cantidad: Math.trunc(input.cantidad),
  });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* El checklist «PASOS PARA UN FULL PERFECTO» de la hoja. */
export async function marcarChecklistFull(
  id: string,
  campo: "empaquetado" | "cancelado" | "descontado",
  valor: boolean,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase
    .from("envio_full_items")
    /* La clave es dinámica y TypeScript la ve como índice genérico; el
       tipo de la tabla lo fija el cast, y `campo` ya está acotado a las tres
       columnas booleanas en la firma. */
    .update({ [campo]: valor } as TablesUpdate<"envio_full_items">)
    .eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarItemFull(id: string): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("envio_full_items").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}
