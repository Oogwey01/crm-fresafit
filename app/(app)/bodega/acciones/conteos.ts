"use server";

import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import type { Resultado } from "@/lib/acciones";
import { revalidar } from "@/app/(app)/bodega/acciones/comun";

/* Conteo físico: contar lo que hay en el anaquel y compararlo contra lo que dice
   el CRM. Vivía en la pestaña Reconciliación de /inventario, pero contar cajas
   se hace en la bodega y con el teléfono en la mano; allá era una pantalla de
   análisis a la que había que entrar a buscarlo.

   Lo que lo distingue del estado «checado» de una carga: aquello cuenta lo que
   ACABA DE LLEGAR en esa carga; esto cuenta lo que hay hoy en el anaquel, y va
   con doble firma —quién contó y quién corroboró—, que es lo que le da valor
   frente a un descuadre. */

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
  /* Revalida /bodega y /inventario: el descuadre se lee aquí, pero el número
     contra el que se compara es el stock del catálogo. */
  revalidar();
  return { ok: true };
}

export async function borrarConteo(id: string): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede borrar conteos.");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("conteos_fisicos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}
