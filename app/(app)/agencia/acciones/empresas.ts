"use server";

/* Acciones de las empresas de la Agencia. Ver el barril en ../actions.ts. */

import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import type { Resultado } from "@/lib/acciones";
import { revalidar, SOLO_ADMINISTRACION } from "@/app/(app)/agencia/acciones/comun";

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
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
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
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
  if ("error" in cx) return cx;
  if (!input.nombre.trim()) return { error: "La empresa necesita un nombre." };

  const { error } = await cx.supabase.from("agencia_empresas").update(filaEmpresa(input)).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarEmpresa(id: string): Promise<Resultado> {
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
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
  const cx = await exigirRol("admin", SOLO_ADMINISTRACION);
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
