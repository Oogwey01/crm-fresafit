"use server";

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import type { CanalId, Customer } from "@/lib/types";

export type ClienteInput = {
  nombre: string;
  telefono: string;
  correo: string;
  canal: CanalId | null;
  notas: string;
};

const RUTAS = ["/clientes", "/metricas"];
const revalidar = () => RUTAS.forEach((r) => revalidatePath(r));

export async function guardarCliente(id: string | null, input: ClienteInput): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede gestionar clientes.");
  if ("error" in cx) return cx;

  const nombre = input.nombre.trim();
  if (!nombre) return { error: "El cliente necesita un nombre." };

  const fila = {
    nombre,
    telefono: textoONulo(input.telefono),
    correo: textoONulo(input.correo),
    canal: input.canal,
    notas: textoONulo(input.notas),
  };

  const { error } = id
    ? await cx.supabase.from("customers").update(fila).eq("id", id)
    : await cx.supabase.from("customers").insert({ ...fila, created_by: cx.user.id });

  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarCliente(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede borrar clientes.");
  if ("error" in cx) return cx;

  /* Las ventas NO se borran: se quedan sin cliente (la FK es ON DELETE SET NULL). */
  const { error } = await cx.supabase.from("customers").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Alta rápida desde el diálogo de venta: solo el nombre. Devuelve el cliente
   para poder seleccionarlo sin recargar. */
export async function crearClienteRapido(
  nombre: string,
  canal: CanalId | null,
): Promise<{ ok: true; cliente: Customer } | { error: string }> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede crear clientes.");
  if ("error" in cx) return cx;

  const limpio = nombre.trim();
  if (!limpio) return { error: "El cliente necesita un nombre." };

  const { data, error } = await cx.supabase
    .from("customers")
    .insert({ nombre: limpio, canal, created_by: cx.user.id })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "No se pudo crear el cliente." };

  revalidar();
  return { ok: true, cliente: data as Customer };
}
