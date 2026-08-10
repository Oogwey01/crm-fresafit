"use server";

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { revalidarConStock } from "@/app/(app)/maquila/acciones/comun";

/* El material que Fresa Fit le tiene a Eduardo en consignación. Todo lo que
   mueve saldo pasa por RPC y no por un update: el envío es un asiento doble
   (baja bodega, sube su saldo) y las dos mitades tienen que ir juntas o no ir.
   La guardia de rol está duplicada aquí y dentro de la función —aquí para dar
   un toast legible, allá porque es el candado de verdad—. */

export async function enviarInsumoMaquila(
  insumoId: string,
  cantidad: number,
  motivo: string,
): Promise<Resultado<{ saldo: number }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const n = Number(cantidad);
  if (!Number.isFinite(n) || n <= 0) return { error: "Di cuántas piezas le mandaste." };

  const { data, error } = await cx.supabase.rpc("maquila_enviar_insumo", {
    iid: insumoId,
    n,
    /* La RPC lo declara con default, así que el tipo generado pide
       `string | undefined`: un null explícito no le vale. */
    p_motivo: textoONulo(motivo) ?? undefined,
  });
  if (error) return { error: error.message };
  revalidarConStock();
  return { ok: true, datos: { saldo: Number(data ?? 0) } };
}

export async function devolverInsumoMaquila(
  insumoId: string,
  cantidad: number,
  motivo: string,
): Promise<Resultado<{ saldo: number }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const n = Number(cantidad);
  if (!Number.isFinite(n) || n <= 0) return { error: "Di cuántas piezas regresaron." };

  const { data, error } = await cx.supabase.rpc("maquila_devolver_insumo", {
    iid: insumoId,
    n,
    /* La RPC lo declara con default, así que el tipo generado pide
       `string | undefined`: un null explícito no le vale. */
    p_motivo: textoONulo(motivo) ?? undefined,
  });
  if (error) return { error: error.message };
  revalidarConStock();
  return { ok: true, datos: { saldo: Number(data ?? 0) } };
}

/* Corrección de conteo: deja el saldo en lo que Eduardo contó. NO toca bodega
   —inventariar stock que nunca existió sería peor que el descuadre— y exige
   motivo, porque un ajuste sin explicación no se puede auditar. */
export async function ajustarConsignacionMaquila(
  insumoId: string,
  saldoNuevo: number,
  motivo: string,
): Promise<Resultado<{ saldo: number }>> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const n = Number(saldoNuevo);
  if (!Number.isFinite(n)) return { error: "Di en cuánto quedó el conteo." };
  if (!motivo.trim()) return { error: "Escribe por qué se ajusta." };

  const { data, error } = await cx.supabase.rpc("maquila_ajustar_consignacion", {
    iid: insumoId,
    saldo_nuevo: n,
    p_motivo: motivo,
  });
  if (error) return { error: error.message };
  revalidarConStock();
  return { ok: true, datos: { saldo: Number(data ?? 0) } };
}

export type InsumoMaquilaInput = {
  nombre: string;
  unidad: string;
  minimo: number;
  /* La ficha del catálogo, si ya existe: con ella, mandarle piezas baja
     bodega. Null = solo se lleva el saldo. */
  producto_id: string | null;
  activo: boolean;
  notas: string;
};

/* Editar el catálogo (ligar la ficha, mover el mínimo, apagar un insumo). Dar
   de alta claves nuevas NO se ofrece: la clave es contrato con el trigger de
   consumo, y un insumo nuevo sin su rama en el trigger no descontaría nada. */
export async function guardarInsumoMaquila(
  insumoId: string,
  input: InsumoMaquilaInput,
): Promise<Resultado> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const nombre = input.nombre.trim();
  if (!nombre) return { error: "Falta el nombre del insumo." };

  const { error } = await cx.supabase
    .from("maquila_insumos")
    .update({
      nombre,
      unidad: input.unidad.trim() || "pieza",
      minimo: Math.max(0, Number(input.minimo) || 0),
      producto_id: input.producto_id,
      activo: input.activo,
      notas: textoONulo(input.notas),
    })
    .eq("id", insumoId);
  if (error) return { error: error.message };
  revalidarConStock();
  return { ok: true };
}
