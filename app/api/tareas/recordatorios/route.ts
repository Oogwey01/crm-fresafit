import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usuarioActual, esInterno } from "@/lib/supabase/usuario-actual";

/* Recordatorios de tarea: genera un aviso in-app para el responsable cuando su
   `recordatorio_at` ya llegó. Igual que /api/inventario/foto, NO va en los crons
   de vercel.json (los 2 del plan Hobby ya están ocupados): lo dispara un
   programador externo (cron-job.org / GitHub Actions) cada ~15 min llamando con
   `Authorization: Bearer <CRON_SECRET>`. Un usuario interno también puede
   dispararlo a mano. Usa service role (salta RLS) para insertar en otros. */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const esCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!esCron) {
    const { user, rol } = await usuarioActual();
    if (!user || !esInterno(rol)) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
  }

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
      return NextResponse.json({ ok: true, enviados: 0 });
    }

    // Un aviso por tarea para cada destinatario (responsable y quien delegó, sin
    // duplicar si son la misma persona).
    const avisos = filas.flatMap((t) => {
      const destinatarios = [...new Set([t.responsable_id, t.created_by].filter(Boolean))] as string[];
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

    return NextResponse.json({ ok: true, enviados: filas.length });
  } catch (e) {
    console.error("[tareas] recordatorios:", e);
    const detalle = e instanceof Error ? e.message : "Falló el envío de recordatorios.";
    return NextResponse.json({ error: detalle }, { status: 500 });
  }
}
