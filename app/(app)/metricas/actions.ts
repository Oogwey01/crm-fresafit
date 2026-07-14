"use server";

import { revalidatePath } from "next/cache";
import { usuarioActual, esInterno } from "@/lib/supabase/usuario-actual";
import { esGestor } from "@/lib/catalogos";
import { importarVentasTN } from "@/lib/tiendanube/ventas";
import type { CanalId } from "@/lib/types";

type Resultado = { ok: true } | { error: string };

export type VentaInput = {
  fecha: string;
  canal: CanalId;
  producto_id: string | null;
  descripcion: string; // para ventas de productos fuera del catálogo
  cantidad: number;
  monto: number;
  notas: string;
};

const RUTAS_VENTAS = ["/metricas"];

function validarVenta(input: VentaInput): string | null {
  if (!input.fecha) return "Falta la fecha de la venta.";
  if (!input.producto_id && !input.descripcion.trim())
    return "Elige un producto o describe qué se vendió.";
  if (!Number.isInteger(input.cantidad) || input.cantidad <= 0)
    return "La cantidad debe ser un entero mayor a cero.";
  if (!Number.isFinite(input.monto) || input.monto < 0) return "El monto no puede ser negativo.";
  return null;
}

export async function registrarVenta(input: VentaInput): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede registrar ventas." };

  const invalido = validarVenta(input);
  if (invalido) return { error: invalido };

  const { error } = await supabase.from("sales").insert({
    fecha: input.fecha,
    canal: input.canal,
    producto_id: input.producto_id,
    descripcion: input.descripcion.trim() || null,
    cantidad: input.cantidad,
    monto: input.monto,
    notas: input.notas.trim() || null,
    origen: "manual",
    created_by: user.id,
  });
  if (error) return { error: error.message };
  RUTAS_VENTAS.forEach((r) => revalidatePath(r));
  return { ok: true };
}

export async function editarVenta(id: string, input: VentaInput): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede editar ventas." };

  const invalido = validarVenta(input);
  if (invalido) return { error: invalido };

  const { error } = await supabase
    .from("sales")
    .update({
      fecha: input.fecha,
      canal: input.canal,
      producto_id: input.producto_id,
      descripcion: input.descripcion.trim() || null,
      cantidad: input.cantidad,
      monto: input.monto,
      notas: input.notas.trim() || null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  RUTAS_VENTAS.forEach((r) => revalidatePath(r));
  return { ok: true };
}

export async function borrarVenta(id: string): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede borrar ventas." };

  const { error } = await supabase.from("sales").delete().eq("id", id);
  if (error) return { error: error.message };
  RUTAS_VENTAS.forEach((r) => revalidatePath(r));
  return { ok: true };
}

/* Importación manual de ventas desde Tienda Nube (botón del panel). La
   automática corre por webhook order/paid y por el cron diario. */
export async function importarVentasTiendanube(): Promise<
  { ok: true; detalle: string } | { error: string }
> {
  const { user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esInterno(rol)) return { error: "Solo el equipo interno puede importar ventas." };

  try {
    const r = await importarVentasTN();
    RUTAS_VENTAS.forEach((r) => revalidatePath(r));
    return {
      ok: true,
      detalle: `Tienda Nube: ${r.insertadas} ventas nuevas de ${r.ordenes} órdenes revisadas${r.retiradas ? `; ${r.retiradas} retiradas por cancelación` : ""}.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falló la importación de ventas." };
  }
}
