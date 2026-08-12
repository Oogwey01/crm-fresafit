"use server";

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { obtenerCategoriaPersonal, obtenerPeriodicidadPersonal } from "@/lib/catalogos";
import { puedeVerFinanzasPersonales } from "@/lib/finanzas/dueno-personales";
import type { CategoriaPersonalId, PeriodicidadPersonalId } from "@/lib/types";
import { NO_ES_TUYO, revalidar } from "@/app/(app)/finanzas/acciones/comun";

export type CompromisoPersonalInput = {
  concepto: string;
  /* Lo de CADA cobro, no lo del mes: repartirlo es cuenta de la pantalla. */
  monto: number;
  periodicidad: PeriodicidadPersonalId;
  dia_pago: number | null;
  categoria: CategoriaPersonalId;
  activo: boolean;
  notas: string;
};

/* `direccion` y no `admin`: administración no tiene sección personal. Y encima
   del rol va el corte por persona, porque `direccion` son tres y la sección es
   de una sola (ver lib/finanzas/dueno-personales.ts). Va aquí además de en la
   pantalla: esconder la pestaña no cierra la acción, y cualquiera de las otras
   direcciones puede llamarla directo.

   Las dos cosas son defensa en profundidad: la RLS de `finanzas_personales` ya
   acota cada fila a su dueño, así que ni sin este corte se podría tocar lo
   ajeno —lo único que evita es que alguien más se cree una lista propia—. */
function noEsSuya(correo: string | null | undefined) {
  return puedeVerFinanzasPersonales(correo) ? null : { error: NO_ES_TUYO };
}

export async function guardarCompromisoPersonal(
  id: string | null,
  input: CompromisoPersonalInput,
): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_ES_TUYO);
  if ("error" in cx) return cx;
  const ajena = noEsSuya(cx.user.email);
  if (ajena) return ajena;

  const concepto = input.concepto.trim();
  if (!concepto) return { error: "Ponle nombre al pago: «Luz», «Internet», «Plan Telcel»." };
  if (!Number.isFinite(input.monto) || input.monto < 0) {
    return { error: "El monto no puede ser negativo." };
  }
  if (!obtenerPeriodicidadPersonal(input.periodicidad)) {
    return { error: "Elige cada cuándo se paga." };
  }
  if (!obtenerCategoriaPersonal(input.categoria)) return { error: "Elige una categoría." };
  if (input.dia_pago !== null && (input.dia_pago < 1 || input.dia_pago > 31)) {
    return { error: "El día de pago va del 1 al 31." };
  }

  const fila = {
    concepto,
    monto: input.monto,
    periodicidad: input.periodicidad,
    dia_pago: input.dia_pago,
    categoria: input.categoria,
    activo: input.activo,
    notas: textoONulo(input.notas),
  };

  if (!id) {
    /* `owner_id` explícito aunque la columna lo traiga por default: que se lea
       aquí de quién es lo que se está guardando. */
    const { error } = await cx.supabase
      .from("finanzas_personales")
      .insert({ ...fila, owner_id: cx.user.id });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true };
  }

  /* El `.eq("owner_id")` es redundante con la RLS a propósito: deja escrito en
     el código de quién es la fila que se toca. Y el `.select("id")` es lo que
     distingue «no era tuya / ya no existe» de «guardado»: un update que no
     encuentra filas NO devuelve error, y sin esto el toast diría «Guardado»
     mientras la pantalla se queda igual. `owner_id` nunca viaja en el update:
     un renglón no cambia de dueño. */
  const { data, error } = await cx.supabase
    .from("finanzas_personales")
    .update(fila)
    .eq("id", id)
    .eq("owner_id", cx.user.id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Ese pago ya no existe." };

  revalidar();
  return { ok: true };
}

export async function borrarCompromisoPersonal(id: string): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_ES_TUYO);
  if ("error" in cx) return cx;
  const ajena = noEsSuya(cx.user.email);
  if (ajena) return ajena;

  const { error } = await cx.supabase
    .from("finanzas_personales")
    .delete()
    .eq("id", id)
    .eq("owner_id", cx.user.id);
  if (error) return { error: error.message };

  revalidar();
  return { ok: true };
}
