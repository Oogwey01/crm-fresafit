import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizarCron, respuestaError } from "@/lib/canales/http";
import { despacharPushPendientes } from "@/lib/push/enviar";

/* Recordatorios de tarea: genera un aviso in-app para el responsable cuando su
   `recordatorio_at` ya llegó. Igual que /api/inventario/foto, NO va en los crons
   de vercel.json (los 2 del plan Hobby ya están ocupados): lo dispara un
   programador externo (cron-job.org / GitHub Actions) cada ~15 min llamando con
   `Authorization: Bearer <CRON_SECRET>`. Un usuario interno también puede
   dispararlo a mano. Usa service role (salta RLS) para insertar en otros. */
export async function GET(request: Request) {
  const noAutorizado = await autorizarCron(request);
  if (noAutorizado) return noAutorizado;

  try {
    const admin = createAdminClient();
    const ahora = new Date().toISOString();

    // Recordatorios vencidos y aún no enviados, no en papelera. Se avisa al
    // responsable Y a quien delegó (created_by), que puede querer el recordatorio
    // aunque la tarea sea de otra persona. Al menos uno de los dos debe existir.
    const { data: pendientes, error } = await admin
      .from("tasks")
      .select("id, titulo, responsable_id, created_by")
      .lte("recordatorio_at", ahora)
      .eq("recordatorio_enviado", false)
      .is("deleted_at", null)
      .or("responsable_id.not.is.null,created_by.not.is.null");
    if (error) throw error;

    const filas = pendientes ?? [];
    if (filas.length === 0) {
      /* Aunque no haya recordatorios, este barrido es la red de seguridad del
         push: si el despacho falló al comentar o al asignar (servidor caído,
         timeout del servicio de push), aquí se recoge lo pendiente. */
      const push = await despacharPushPendientes();
      return NextResponse.json({ ok: true, enviados: 0, push });
    }

    /* Las demás personas sumadas a estas tareas: el recordatorio es de todo el
       equipo, no solo del principal. Si la tabla aún no existe (la migración de
       coasignados se aplica a mano), se sigue avisando como antes. */
    const coasignadosPorTarea = new Map<string, string[]>();
    const { data: coasignados, error: coasErr } = await admin
      .from("task_assignees")
      .select("task_id, user_id")
      .in(
        "task_id",
        filas.map((t) => t.id),
      );
    if (coasErr) {
      console.warn("[recordatorios] task_assignees no disponible:", coasErr.message);
    }
    for (const c of (coasignados ?? []) as { task_id: string; user_id: string }[]) {
      coasignadosPorTarea.set(c.task_id, [...(coasignadosPorTarea.get(c.task_id) ?? []), c.user_id]);
    }

    // Un aviso por tarea para cada destinatario (el equipo y quien delegó, sin
    // duplicar si son la misma persona).
    const avisos = filas.flatMap((t) => {
      const destinatarios = [
        ...new Set(
          [t.responsable_id, t.created_by, ...(coasignadosPorTarea.get(t.id) ?? [])].filter(Boolean),
        ),
      ] as string[];
      return destinatarios.map((uid) => ({
        user_id: uid,
        task_id: t.id,
        tipo: "recordatorio",
        texto: `Recordatorio: ${t.titulo}`,
      }));
    });
    const { error: insErr } = await admin.from("notifications").insert(avisos);
    if (insErr) throw insErr;

    // Marcar como enviados (no re-disparar).
    const { error: updErr } = await admin
      .from("tasks")
      .update({ recordatorio_enviado: true })
      .in(
        "id",
        filas.map((t) => t.id),
      );
    if (updErr) throw updErr;

    // Empujar al celular/escritorio lo recién creado (y lo que hubiera quedado
    // pendiente de barridos anteriores).
    const push = await despacharPushPendientes();

    return NextResponse.json({ ok: true, enviados: filas.length, push });
  } catch (e) {
    return respuestaError(e, "tareas recordatorios", "Falló el envío de recordatorios.");
  }
}
