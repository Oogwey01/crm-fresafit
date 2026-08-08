"use server";

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { sumarDias } from "@/lib/fecha";
import type { AcabadoMaquilaId, ComboMaquilaId, ModeloMaquilaId } from "@/lib/types";
import { revalidar } from "@/app/(app)/maquila/acciones/comun";

/* Marcar una ficha del catálogo como "de maquila" es lo que enciende la
   ingesta para ese producto: sin fila aquí, sus ventas de Tienda Nube pasan de
   largo. Decide qué se fabrica y a qué tarifa se liga → administración. */
export async function marcarFichaMaquila(
  productoId: string,
  modelo: ModeloMaquilaId,
  acabado: AcabadoMaquilaId,
  combo: ComboMaquilaId,
): Promise<Resultado> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("maquila_productos")
    .upsert(
      { producto_id: productoId, modelo, acabado, combo, activo: true, created_by: cx.user.id },
      { onConflict: "producto_id" },
    );
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Apagar sin borrar: conserva modelo y acabado por si el diseño vuelve. */
export async function cambiarFichaMaquilaActiva(
  productoId: string,
  activo: boolean,
): Promise<Resultado> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("maquila_productos")
    .update({ activo })
    .eq("producto_id", productoId);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function guardarConfigMaquila(input: {
  hora_limite: string; // "HH:mm"
  sabado_habil: boolean;
}): Promise<Resultado> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  if (!/^\d{2}:\d{2}$/.test(input.hora_limite)) {
    return { error: "La hora límite debe verse como 13:00." };
  }
  const { error } = await cx.supabase
    .from("maquila_config")
    .update({
      hora_limite: input.hora_limite,
      sabado_habil: input.sabado_habil,
      updated_by: cx.user.id,
    })
    .eq("id", 1);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Un festivo o un cierre del taller; con `hasta` inserta el rango entero, un
   día por fila, que es la forma que el cálculo de fechas sabe leer. Los
   pedidos YA clasificados no se recalculan: la promesa dada no se mueve sola. */
export async function agregarFestivoMaquila(input: {
  desde: string;
  hasta?: string | null;
  tipo: "festivo" | "cierre";
  motivo: string;
}): Promise<Resultado<{ dias: number }>> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!esFecha(input.desde)) return { error: "La fecha no se entiende." };
  const hasta = input.hasta && esFecha(input.hasta) ? input.hasta : input.desde;
  if (hasta < input.desde) return { error: "El rango está al revés." };

  const filas: { fecha: string; tipo: "festivo" | "cierre"; motivo: string | null; created_by: string }[] = [];
  for (let d = input.desde; d <= hasta && filas.length < 60; d = sumarDias(d, 1)) {
    filas.push({ fecha: d, tipo: input.tipo, motivo: textoONulo(input.motivo), created_by: cx.user.id });
  }
  if (filas.length >= 60) return { error: "Un cierre de más de 60 días parece un error de captura." };

  const { error } = await cx.supabase
    .from("maquila_festivos")
    .upsert(filas, { onConflict: "fecha" });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true, datos: { dias: filas.length } };
}

export async function quitarFestivoMaquila(fecha: string): Promise<Resultado> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("maquila_festivos").delete().eq("fecha", fecha);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Las tarifas solo CRECEN: se agrega una vigencia nueva y la anterior queda
   para liquidar piezas viejas a su costo viejo. Negociación con un proveedor →
   dirección, el mismo escalón que el módulo Proveedores. */
export async function agregarCostoMaquila(input: {
  modelo: ModeloMaquilaId;
  acabado: AcabadoMaquilaId;
  costo: number;
  vigente_desde: string;
}): Promise<Resultado> {
  const cx = await exigirRol("direccion");
  if ("error" in cx) return cx;

  const costo = Number(input.costo);
  if (!Number.isFinite(costo) || costo < 0) return { error: "El costo no se entiende." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.vigente_desde)) return { error: "La vigencia no se entiende." };

  const { error } = await cx.supabase.from("maquila_costos").insert({
    modelo: input.modelo,
    acabado: input.acabado,
    costo,
    vigente_desde: input.vigente_desde,
    created_by: cx.user.id,
  });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}
