"use server";

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { importarVentasTN } from "@/lib/tiendanube/ventas";
import type { CanalId } from "@/lib/types";

export type VentaInput = {
  fecha: string;
  canal: CanalId;
  producto_id: string | null;
  descripcion: string; // para ventas de productos fuera del catálogo
  cantidad: number;
  monto: number;
  cliente_id: string | null;
  notas: string;
};

const RUTAS_VENTAS = ["/metricas", "/clientes"];

function validarVenta(input: VentaInput): string | null {
  if (!input.fecha) return "Falta la fecha de la venta.";
  if (!input.producto_id && !input.descripcion.trim())
    return "Elige un producto o describe qué se vendió.";
  if (!Number.isInteger(input.cantidad) || input.cantidad <= 0)
    return "La cantidad debe ser un entero mayor a cero.";
  if (!Number.isFinite(input.monto) || input.monto < 0) return "El monto no puede ser negativo.";
  return null;
}

/* Columnas comunes del insert (registrar) y el update (editar) de una venta;
   cada action añade lo suyo (origen/created_by). */
function filaDeVenta(input: VentaInput) {
  return {
    fecha: input.fecha,
    canal: input.canal,
    producto_id: input.producto_id,
    descripcion: textoONulo(input.descripcion),
    cantidad: input.cantidad,
    monto: input.monto,
    cliente_id: input.cliente_id,
    notas: textoONulo(input.notas),
  };
}

export async function registrarVenta(input: VentaInput): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede registrar ventas.");
  if ("error" in cx) return cx;

  const invalido = validarVenta(input);
  if (invalido) return { error: invalido };

  const { error } = await cx.supabase.from("sales").insert({
    ...filaDeVenta(input),
    origen: "manual",
    created_by: cx.user.id,
  });
  if (error) return { error: error.message };
  RUTAS_VENTAS.forEach((r) => revalidatePath(r));
  return { ok: true };
}

export async function editarVenta(id: string, input: VentaInput): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede editar ventas.");
  if ("error" in cx) return cx;

  const invalido = validarVenta(input);
  if (invalido) return { error: invalido };

  /* Las ventas traídas de un canal las gobierna la plataforma. Editar su precio
     o su cantidad aquí descuadraba el CRM contra el canal de forma permanente:
     la re-sincronización no reescribe renglones ya existentes, así que el cambio
     no se revertía nunca y nadie se enteraba. Se permiten solo los campos que sí
     son del equipo (cliente y notas); del resto manda el canal.
     La RLS refuerza lo mismo, esto es la defensa en profundidad de siempre. */
  const { data: actual, error: errLeer } = await cx.supabase
    .from("sales")
    .select("origen")
    .eq("id", id)
    .single();
  if (errLeer) return { error: errLeer.message };

  const esImportada = actual?.origen === "api";
  const cambios =
    esImportada && cx.rol !== "direccion"
      ? { cliente_id: input.cliente_id, notas: textoONulo(input.notas) }
      : filaDeVenta(input);

  const { error } = await cx.supabase.from("sales").update(cambios).eq("id", id);
  if (error) return { error: error.message };
  RUTAS_VENTAS.forEach((r) => revalidatePath(r));
  return { ok: true };
}

export async function borrarVenta(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede borrar ventas.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("sales").delete().eq("id", id);
  if (error) return { error: error.message };
  RUTAS_VENTAS.forEach((r) => revalidatePath(r));
  return { ok: true };
}

/* Importación manual de ventas desde Tienda Nube (botón del panel). La
   automática corre por webhook order/paid y por el cron diario. */
export async function importarVentasTiendanube(): Promise<
  { ok: true; detalle: string } | { error: string }
> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede importar ventas.");
  if ("error" in cx) return cx;

  try {
    const r = await importarVentasTN();
    RUTAS_VENTAS.forEach((ruta) => revalidatePath(ruta));
    return {
      ok: true,
      detalle: `Tienda Nube: ${r.insertadas} ventas nuevas de ${r.ordenes} órdenes revisadas${r.clientes ? `; ${r.clientes} clientes al día` : ""}${r.retiradas ? `; ${r.retiradas} retiradas por cancelación` : ""}.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falló la importación de ventas." };
  }
}
