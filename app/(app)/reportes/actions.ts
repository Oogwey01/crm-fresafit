"use server";

/* Acciones de reportes. Vive en su propia ruta, no en /agencia, porque el módulo existe en los DOS
   espacios sobre las mismas tablas: /nomina y /agencia/nomina, /reportes y
   /agencia/reportes. */

import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import type { Resultado } from "@/lib/acciones";
import { revalidar, SOLO_ADMINISTRACION } from "@/app/(app)/agencia/acciones/comun";

/* =============================== Reportes ================================= */

export type ReporteInput = {
  /* Vacío = reporte propio de Fresafit, sin cliente que lo pida. */
  empresa_id: string;
  titulo: string;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  resumen: string;
  url: string;
  entregado: boolean;
};

function filaReporte(input: ReporteInput, entregadoPrevio: string | null) {
  return {
    empresa_id: input.empresa_id || null,
    titulo: input.titulo.trim(),
    periodo_desde: input.periodo_desde || null,
    periodo_hasta: input.periodo_hasta || null,
    resumen: textoONulo(input.resumen),
    url: textoONulo(input.url),
    /* Se conserva la fecha original de entrega si ya estaba entregado: editar el
       resumen no debe reescribir cuándo se le mandó al cliente. */
    entregado_at: input.entregado ? (entregadoPrevio ?? new Date().toISOString()) : null,
  };
}

export async function crearReporte(input: ReporteInput): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  if (!input.titulo.trim()) return { error: "El reporte necesita un título." };

  const { error } = await cx.supabase
    .from("reportes")
    .insert({ ...filaReporte(input, null), created_by: cx.user.id });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function editarReporte(
  id: string,
  input: ReporteInput,
  entregadoPrevio: string | null,
): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  if (!input.titulo.trim()) return { error: "El reporte necesita un título." };

  const { error } = await cx.supabase
    .from("reportes")
    .update(filaReporte(input, entregadoPrevio))
    .eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarReporte(id: string): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("reportes").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}
