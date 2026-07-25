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

    // Recordatorios vencidos y aún no enviados, con responsable y no en papelera.
    const { data: pendientes, error } = await admin
      .from("tasks")
      .select("id, titulo, responsable_id")
      .lte("recordatorio_at", ahora)
      .eq("recordatorio_enviado", false)
      .is("deleted_at", null)
      .not("responsable_id", "is", null);
    if (error) throw error;

    const filas = pendientes ?? [];
    if (filas.length === 0) {
      return NextResponse.json({ ok: true, enviados: 0 });
    }

    // Un aviso por tarea para su responsable.
    const { error: insErr } = await admin.from("notifications").insert(
      filas.map((t) => ({
        user_id: t.responsable_id,
        task_id: t.id,
        tipo: "recordatorio",
        texto: `Recordatorio: ${t.titulo}`,
      })),
    );
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
