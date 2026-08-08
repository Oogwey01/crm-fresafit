"use server";

/* Compartir (y dejar de compartir) un elemento con la empresa cliente.

   Es la acción más delicada del módulo: es la que decide qué sale de casa. Por
   eso lleva tres cierres y no uno —
     1. la UI solo pinta el botón a quien manda en la tarea;
     2. esto vuelve a comprobarlo con `exigirMandoTarea`, que es la misma regla
        (gestor, o quien la creó);
     3. y el trigger `restringir_update_tarea` congela la columna `visibilidad`
        para todos los demás, aunque llamen a PostgREST a mano.
   Además el cambio queda en `actividad_empresas` por trigger, con quién y
   cuándo: es exactamente el dato que se pide cuando algo se compartió de más. */

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirMandoTarea } from "@/app/(app)/tareas/acciones/comun";
import { VISIBILIDADES } from "@/lib/catalogos";
import type { VisibilidadId } from "@/lib/types";

const RUTAS = ["/agencia/clientes", "/agencia/tareas", "/tareas", "/portal/tareas"];

export async function cambiarVisibilidad(
  taskId: string,
  visibilidad: VisibilidadId,
): Promise<Resultado> {
  if (!VISIBILIDADES.some((v) => v.id === visibilidad)) {
    return { error: "Ese nivel de visibilidad no existe." };
  }

  const cx = await exigirMandoTarea(
    taskId,
    "Solo dirección, coordinación o quien creó la tarea puede decidir si se comparte.",
  );
  if ("error" in cx) return cx;

  /* Compartir exige cliente. La BD lo frena con `tasks_compartida_con_empresa`,
     pero el error de un check no se le puede enseñar a nadie. */
  if (visibilidad === "compartido") {
    const { data } = await cx.supabase
      .from("tasks")
      .select("empresa_id, espacio")
      .eq("id", taskId)
      .maybeSingle();
    if (!data?.empresa_id || data.espacio !== "agencia") {
      return { error: "Antes de compartirla, dile a qué cliente pertenece." };
    }
  }

  const { error } = await cx.supabase.from("tasks").update({ visibilidad }).eq("id", taskId);
  if (error) return { error: error.message };

  RUTAS.forEach((r) => revalidatePath(r));
  return { ok: true };
}
