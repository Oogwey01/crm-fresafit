"use server";

/* Acciones de nómina. Vive en su propia ruta, no en /agencia, porque el módulo existe en los DOS
   espacios sobre las mismas tablas: /nomina y /agencia/nomina, /reportes y
   /agencia/reportes. */

import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import type { Resultado } from "@/lib/acciones";
import type {
  EstadoPagoNominaId,
} from "@/lib/types";
import { revalidar, SOLO_ADMINISTRACION } from "@/app/(app)/agencia/acciones/comun";

/* ================================ Nómina ================================== */

export type EmpleadoInput = {
  profile_id: string | null;
  nombre: string;
  puesto: string;
  empresa_id: string | null;
  esquema: string;
  monto: number;
  periodicidad: string;
  dia_corte: number | null;
  situacion: string;
  activo: boolean;
  inicio: string | null;
  notas: string;
};

function filaEmpleado(input: EmpleadoInput) {
  return {
    profile_id: input.profile_id,
    nombre: input.nombre.trim(),
    puesto: textoONulo(input.puesto),
    empresa_id: input.empresa_id,
    esquema: input.esquema,
    monto: input.monto,
    periodicidad: input.periodicidad,
    dia_corte: input.dia_corte,
    situacion: input.situacion,
    activo: input.activo,
    inicio: input.inicio || null,
    notas: textoONulo(input.notas),
  };
}

export async function crearEmpleado(input: EmpleadoInput): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  if (!input.nombre.trim()) return { error: "Falta el nombre de la persona." };
  if (!(input.monto >= 0)) return { error: "El monto no es válido." };

  const { error } = await cx.supabase.from("nomina_empleados").insert(filaEmpleado(input));
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function editarEmpleado(id: string, input: EmpleadoInput): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  if (!input.nombre.trim()) return { error: "Falta el nombre de la persona." };
  if (!(input.monto >= 0)) return { error: "El monto no es válido." };

  const { error } = await cx.supabase.from("nomina_empleados").update(filaEmpleado(input)).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarEmpleado(id: string): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("nomina_empleados").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function registrarPago(input: {
  empleado_id: string;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  monto: number;
  estado: EstadoPagoNominaId;
  fecha_pago: string | null;
  metodo: string;
  comprobante: string;
  notas: string;
}): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  if (!(input.monto > 0)) return { error: "El monto del pago tiene que ser mayor que cero." };

  const { error } = await cx.supabase.from("nomina_pagos").insert({
    empleado_id: input.empleado_id,
    periodo_desde: input.periodo_desde || null,
    periodo_hasta: input.periodo_hasta || null,
    monto: input.monto,
    estado: input.estado,
    /* Si se registra ya pagado y no se dijo cuándo, fue hoy. */
    fecha_pago:
      input.fecha_pago || (input.estado === "pagado" ? new Date().toISOString().slice(0, 10) : null),
    metodo: textoONulo(input.metodo),
    comprobante: textoONulo(input.comprobante),
    notas: textoONulo(input.notas),
    created_by: cx.user.id,
  });
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Esa persona ya tiene un pago registrado para ese periodo."
          : error.message,
    };
  }
  revalidar();
  return { ok: true };
}

export async function marcarPagoPagado(id: string, pagado: boolean): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase
    .from("nomina_pagos")
    .update({
      estado: pagado ? "pagado" : "pendiente",
      fecha_pago: pagado ? new Date().toISOString().slice(0, 10) : null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarPago(id: string): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("nomina_pagos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}
