"use server";

/* ============================================================================
   Acciones de la Agencia Fresafit.
   ----------------------------------------------------------------------------
   Todo el módulo es de dirección: son contratos de terceros y sueldos del
   equipo. La RLS lo aplica en la base; esto es la primera capa y la que da un
   mensaje entendible en vez de un error de permisos.
   ============================================================================ */

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { calcularCorte, nombrePeriodo } from "@/lib/agencia";
import type { Resultado } from "@/lib/acciones";
import type {
  AgenciaContrato,
  EstadoIngresoId,
  EstadoPagoNominaId,
  TipoIngresoId,
} from "@/lib/types";

/* Nómina y reportes existen en los DOS espacios (Fresafit y Agencia) sobre las
   mismas tablas, así que al guardar hay que refrescar ambos: mover a alguien de
   empresa lo saca de una lista y lo mete en la otra. */
const RUTAS = [
  "/agencia/empresas",
  "/agencia/cobros",
  "/agencia/nomina",
  "/agencia/reportes",
  "/nomina",
  "/reportes",
];
const revalidar = () => RUTAS.forEach((r) => revalidatePath(r));

const SOLO_DIRECCION = "Solo dirección puede ver y mover la información de la Agencia.";

/* =============================== Empresas ================================= */

export type EmpresaInput = {
  nombre: string;
  giro: string;
  color: string;
  contacto_nombre: string;
  contacto_correo: string;
  contacto_telefono: string;
  inicio: string | null;
  activa: boolean;
  notas: string;
};

/* Identificador corto y estable a partir del nombre ("Bart Jerseys" →
   "bart-jerseys"). Se usa en rutas y reportes, así que no lleva acentos ni
   espacios. */
function aSlug(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function filaEmpresa(input: EmpresaInput) {
  return {
    nombre: input.nombre.trim(),
    giro: textoONulo(input.giro),
    color: input.color || "#e84393",
    contacto_nombre: textoONulo(input.contacto_nombre),
    contacto_correo: textoONulo(input.contacto_correo),
    contacto_telefono: textoONulo(input.contacto_telefono),
    inicio: input.inicio || null,
    activa: input.activa,
    notas: textoONulo(input.notas),
  };
}

export async function crearEmpresa(input: EmpresaInput): Promise<Resultado> {
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;
  const nombre = input.nombre.trim();
  if (!nombre) return { error: "La empresa necesita un nombre." };

  const { error } = await cx.supabase.from("agencia_empresas").insert({
    ...filaEmpresa(input),
    slug: aSlug(nombre) || crypto.randomUUID().slice(0, 8),
    created_by: cx.user.id,
  });
  if (error) {
    return {
      error: error.code === "23505" ? "Ya existe una empresa con ese nombre." : error.message,
    };
  }
  revalidar();
  return { ok: true };
}

export async function editarEmpresa(id: string, input: EmpresaInput): Promise<Resultado> {
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;
  if (!input.nombre.trim()) return { error: "La empresa necesita un nombre." };

  const { error } = await cx.supabase.from("agencia_empresas").update(filaEmpresa(input)).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarEmpresa(id: string): Promise<Resultado> {
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("agencia_empresas").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Quién del equipo atiende a la empresa. Se manda la lista completa y se
   reemplaza: es un puñado de personas y así no hay que llevar diffs. */
export async function guardarEquipo(
  empresaId: string,
  asignaciones: { profile_id: string; papel: string }[],
): Promise<Resultado> {
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;

  const { error: errBorrar } = await cx.supabase
    .from("agencia_asignaciones")
    .delete()
    .eq("empresa_id", empresaId);
  if (errBorrar) return { error: errBorrar.message };

  if (asignaciones.length > 0) {
    const { error } = await cx.supabase.from("agencia_asignaciones").insert(
      asignaciones.map((a) => ({
        empresa_id: empresaId,
        profile_id: a.profile_id,
        papel: textoONulo(a.papel),
      })),
    );
    if (error) return { error: error.message };
  }
  revalidar();
  return { ok: true };
}

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
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;
  const invalido = validarContrato(input);
  if (invalido) return { error: invalido };

  const { error } = await cx.supabase.from("agencia_contratos").insert(filaContrato(input));
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function editarContrato(id: string, input: ContratoInput): Promise<Resultado> {
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;
  const invalido = validarContrato(input);
  if (invalido) return { error: invalido };

  const { error } = await cx.supabase.from("agencia_contratos").update(filaContrato(input)).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarContrato(id: string): Promise<Resultado> {
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("agencia_contratos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

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
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
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
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
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
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;

  const ahora = new Date().toISOString();
  const patch: Record<string, unknown> = { estado };
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
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;

  const fila: Record<string, unknown> = {};
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
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("agencia_ingresos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

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
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;
  if (!input.nombre.trim()) return { error: "Falta el nombre de la persona." };
  if (!(input.monto >= 0)) return { error: "El monto no es válido." };

  const { error } = await cx.supabase.from("nomina_empleados").insert(filaEmpleado(input));
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function editarEmpleado(id: string, input: EmpleadoInput): Promise<Resultado> {
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;
  if (!input.nombre.trim()) return { error: "Falta el nombre de la persona." };
  if (!(input.monto >= 0)) return { error: "El monto no es válido." };

  const { error } = await cx.supabase.from("nomina_empleados").update(filaEmpleado(input)).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarEmpleado(id: string): Promise<Resultado> {
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
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
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
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
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
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
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("nomina_pagos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

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
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
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
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
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
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("reportes").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}
