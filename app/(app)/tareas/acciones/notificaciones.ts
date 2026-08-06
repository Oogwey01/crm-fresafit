"use server";

/* Acciones de avisos y tareas compartidas (Tareas). Ver el barril en ../actions.ts. */

import { refresh } from "next/cache";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { esGestor } from "@/lib/catalogos";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import {
  revalidarTareas,
} from "@/app/(app)/tareas/acciones/comun";

/* ============================ Notificaciones ============================== */

export async function marcarNotificacionLeida(id: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("notifications").update({ leida: true }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}

export async function marcarTodasLeidas(): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase
    .from("notifications")
    .update({ leida: true })
    .eq("user_id", cx.user.id)
    .eq("leida", false);
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}

/* Marca la tarea como vista POR MÍ: es lo que apaga el punto de "hay algo
   nuevo". `ultima_actividad_at` es global a la tarea, así que la lectura tiene
   que ser por persona (tabla task_reads). */
export async function marcarTareaLeida(taskId: string): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase
    .from("task_reads")
    .upsert(
      { task_id: taskId, user_id: cx.user.id, leido_at: new Date().toISOString() },
      { onConflict: "task_id,user_id" },
    );
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}

/* ============================ Compartir (externo) ========================= */

export async function compartirTarea(taskId: string, userIds: string[]): Promise<Resultado> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede compartir tareas." };

  /* Reemplaza el conjunto de compartidos por el nuevo, insertando ANTES de
     podar. Al revés —borrar todo y luego insertar— un fallo entre las dos
     sentencias dejaba la tarea sin ningún compartido, que es pérdida de datos;
     así lo peor que puede pasar es que sobre alguien, que se ve y se corrige.
     El upsert absorbe a quien ya estaba (la llave es el par tarea+persona). */
  if (userIds.length) {
    const filas = userIds.map((uid) => ({ task_id: taskId, user_id: uid }));
    const { error } = await supabase
      .from("task_shares")
      .upsert(filas, { onConflict: "task_id,user_id" });
    if (error) return { error: error.message };
  }

  let poda = supabase.from("task_shares").delete().eq("task_id", taskId);
  if (userIds.length) poda = poda.not("user_id", "in", `(${userIds.join(",")})`);
  const { error: delErr } = await poda;
  if (delErr) return { error: delErr.message };

  revalidarTareas();
  return { ok: true };
}
