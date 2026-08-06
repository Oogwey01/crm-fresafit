"use server";

/* Acciones de los contratos. Ver el barril en ../actions.ts. */

import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import type { Resultado } from "@/lib/acciones";
import { revalidar, SOLO_ADMINISTRACION } from "@/app/(app)/agencia/acciones/comun";

/* =============================== Contratos ================================ */

export type ContratoInput = {
  empresa_id: string;
  nombre: string;
  monto_fijo: number;
  porcentaje: number;
  base_calculo: string;
  plataforma: string;
  dia_corte: number;
  periodicidad: "mensual" | "quincenal";
  fondo_delegado: number;
  inicio: string | null;
  fin: string | null;
  activo: boolean;
  notas: string;
};

function validarContrato(input: ContratoInput): string | null {
  if (!input.empresa_id) return "Falta la empresa.";
  if (!input.nombre.trim()) return "El contrato necesita un nombre.";
  if (input.monto_fijo < 0 || input.fondo_delegado < 0) return "Los montos no pueden ser negativos.";
  if (input.porcentaje < 0 || input.porcentaje > 100) return "El porcentaje va de 0 a 100.";
  if (input.dia_corte < 1 || input.dia_corte > 28) {
    /* Tope en 28 para que el corte exista en febrero: un contrato que cierra el
       30 no tendría fecha de corte ese mes. */
    return "El día de corte va del 1 al 28.";
  }
  if (input.monto_fijo === 0 && input.porcentaje === 0 && input.fondo_delegado === 0) {
    return "El contrato no cobra nada: pon un monto fijo, un porcentaje o un fondo delegado.";
  }
  return null;
}

function filaContrato(input: ContratoInput) {
  return {
    empresa_id: input.empresa_id,
    nombre: input.nombre.trim(),
    monto_fijo: input.monto_fijo,
    porcentaje: input.porcentaje,
    base_calculo: input.base_calculo,
    plataforma: input.plataforma,
    dia_corte: input.dia_corte,
    periodicidad: input.periodicidad,
    fondo_delegado: input.fondo_delegado,
    inicio: input.inicio || null,
    fin: input.fin || null,
    activo: input.activo,
    notas: textoONulo(input.notas),
  };
}

export async function crearContrato(input: ContratoInput): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  const invalido = validarContrato(input);
  if (invalido) return { error: invalido };

  const { error } = await cx.supabase.from("agencia_contratos").insert(filaContrato(input));
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function editarContrato(id: string, input: ContratoInput): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  const invalido = validarContrato(input);
  if (invalido) return { error: invalido };

  const { error } = await cx.supabase.from("agencia_contratos").update(filaContrato(input)).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarContrato(id: string): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("agencia_contratos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}
