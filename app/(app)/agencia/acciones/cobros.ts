"use server";

/* Acciones de los cobros. Ver el barril en ../actions.ts. */

import { exigirRol } from "@/lib/supabase/guardia";
import type { TablesUpdate } from "@/lib/supabase/tipos-bd";
import { textoONulo } from "@/lib/validacion";
import { calcularCorte, nombrePeriodo } from "@/lib/agencia";
import type { Resultado } from "@/lib/acciones";
import type {
  AgenciaContrato,
  EstadoIngresoId,
  TipoIngresoId,
} from "@/lib/types";
import { revalidar, SOLO_ADMINISTRACION } from "@/app/(app)/agencia/acciones/comun";

/* ================================ Cobros ================================== */

/* Cierra un periodo de un contrato: se captura lo que vendió el cliente y el CRM
   arma el cobro. El desglose se guarda congelado —fijo, porcentaje y variable—
   porque las reglas se renegocian y un cobro de marzo tiene que seguir
   explicándose con las de marzo. */
export async function calcularCorteContrato(input: {
  contrato_id: string;
  periodo_desde: string;
  periodo_hasta: string;
  ventas_base: number;
  ventas_nota: string;
}): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;

  if (!input.periodo_desde || !input.periodo_hasta) return { error: "Falta el periodo a cobrar." };
  if (input.periodo_desde > input.periodo_hasta) {
    return { error: "El periodo termina antes de empezar." };
  }
  if (!(input.ventas_base >= 0)) return { error: "Las ventas del periodo no son un número válido." };

  const { data: contrato, error: errC } = await cx.supabase
    .from("agencia_contratos")
    .select("*, empresa:agencia_empresas!empresa_id(id, nombre)")
    .eq("id", input.contrato_id)
    .single();
  if (errC) return { error: errC.message };

  const c = contrato as unknown as AgenciaContrato & { empresa: { nombre: string } | null };
  const desglose = calcularCorte(
    { monto_fijo: c.monto_fijo, porcentaje: c.porcentaje, fondo_delegado: c.fondo_delegado },
    input.ventas_base,
  );

  const { error } = await cx.supabase.from("agencia_ingresos").insert({
    empresa_id: c.empresa_id,
    contrato_id: c.id,
    tipo: "contrato" satisfies TipoIngresoId,
    concepto: `${c.nombre} · ${nombrePeriodo(input.periodo_desde, input.periodo_hasta)}`,
    periodo_desde: input.periodo_desde,
    periodo_hasta: input.periodo_hasta,
    ventas_base: input.ventas_base,
    ventas_origen: "manual",
    ventas_nota: textoONulo(input.ventas_nota),
    monto_fijo: desglose.monto_fijo,
    porcentaje: c.porcentaje,
    monto_variable: desglose.monto_variable,
    fondo_delegado: desglose.fondo_delegado,
    total: desglose.total,
    estado: "calculado" satisfies EstadoIngresoId,
    created_by: cx.user.id,
  });
  if (error) {
    /* El índice único sobre (contrato, periodo) es lo que impide facturar dos
       veces el mismo mes por un doble clic. */
    return {
      error:
        error.code === "23505"
          ? "Ese periodo ya se calculó para este contrato. Búscalo en la lista de cobros."
          : error.message,
    };
  }
  revalidar();
  return { ok: true };
}

export type IngresoSueltoInput = {
  empresa_id: string | null;
  tipo: TipoIngresoId;
  concepto: string;
  total: number;
  socio: string;
  notas: string;
};

/* Ingresos que no salen de un contrato: migraciones de plataforma y comisiones
   por referidos (contador, Tienda Nube, Kubo, Revie). */
export async function registrarIngreso(input: IngresoSueltoInput): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  if (!input.concepto.trim()) return { error: "Falta decir de qué es el cobro." };
  if (!(input.total > 0)) return { error: "El monto tiene que ser mayor que cero." };

  const { error } = await cx.supabase.from("agencia_ingresos").insert({
    empresa_id: input.empresa_id,
    tipo: input.tipo,
    concepto: input.concepto.trim(),
    total: input.total,
    socio: textoONulo(input.socio),
    notas: textoONulo(input.notas),
    estado: "calculado" satisfies EstadoIngresoId,
    created_by: cx.user.id,
  });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Avanza el cobro por su ciclo. Las marcas de tiempo se ponen aquí y no en el
   formulario: lo que importa es cuándo se movió de verdad. */
export async function cambiarEstadoIngreso(
  id: string,
  estado: EstadoIngresoId,
): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;

  const ahora = new Date().toISOString();
  const patch: TablesUpdate<"agencia_ingresos"> = { estado };
  if (estado === "cobrado") {
    patch.cobrado_at = ahora;
    patch.pagado_at = null;
  } else if (estado === "pagado") {
    patch.pagado_at = ahora;
  } else {
    /* Volver a "calculado" o cancelar limpia las marcas: si no, un cobro
       revertido seguiría contando como pagado en los totales. */
    patch.cobrado_at = null;
    patch.pagado_at = null;
  }

  const { error } = await cx.supabase.from("agencia_ingresos").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function editarIngreso(
  id: string,
  patch: { concepto?: string; total?: number; factura?: string; notas?: string },
): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;

  const fila: TablesUpdate<"agencia_ingresos"> = {};
  if (patch.concepto !== undefined) {
    if (!patch.concepto.trim()) return { error: "El concepto no puede quedar vacío." };
    fila.concepto = patch.concepto.trim();
  }
  if (patch.total !== undefined) {
    if (!(patch.total >= 0)) return { error: "El monto no es válido." };
    fila.total = patch.total;
  }
  if (patch.factura !== undefined) fila.factura = textoONulo(patch.factura);
  if (patch.notas !== undefined) fila.notas = textoONulo(patch.notas);

  const { error } = await cx.supabase.from("agencia_ingresos").update(fila).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarIngreso(id: string): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("agencia_ingresos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}
