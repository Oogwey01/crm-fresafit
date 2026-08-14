import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizarCron, respuestaError } from "@/lib/canales/http";
import { despacharPushPendientes } from "@/lib/push/enviar";
import { hoyISO } from "@/lib/fecha";
import { proximoPago } from "@/lib/finanzas/personales";
import type { CompromisoPersonal } from "@/lib/types";

/* Aviso de gasto fijo por vencer (audio 13/08): si a un pago fijo personal le
   toca HOY o MAÑANA, su dueño recibe un aviso (campana + push). Corre dentro
   de este mismo barrido para no pedirle otro job a cron-job.org. Dedup por
   día: no se repite el aviso del mismo compromiso en el mismo día aunque el
   cron pase cada 15 minutos. Su fallo nunca tira los recordatorios de tareas. */
async function avisarGastosFijos(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  try {
    const hoy = hoyISO();
    const { data, error } = await admin
      .from("finanzas_personales")
      .select("id, owner_id, concepto, monto, periodicidad, dia_pago, fecha_unica, activo")
      .eq("activo", true);
    if (error) throw error;

    const proximos = ((data ?? []) as Pick<
      CompromisoPersonal,
      "id" | "owner_id" | "concepto" | "monto" | "periodicidad" | "dia_pago" | "fecha_unica" | "activo"
    >[])
      .map((c) => ({ c, fecha: proximoPago(c.dia_pago, c.periodicidad, hoy, c.fecha_unica) }))
      .filter((x): x is typeof x & { fecha: string } => x.fecha !== null)
      .filter((x) => {
        const dias = (Date.parse(x.fecha) - Date.parse(hoy)) / 86_400_000;
        return dias >= 0 && dias <= 1;
      });
    if (proximos.length === 0) return 0;

    /* Ya avisados hoy (el texto lleva el concepto y la fecha: es la llave). */
    const { data: previos } = await admin
      .from("notifications")
      .select("user_id, texto")
      .eq("tipo", "gasto_fijo")
      .gte("created_at", `${hoy}T00:00:00Z`);
    const yaAvisados = new Set((previos ?? []).map((n) => `${n.user_id}|${n.texto}`));

    const avisos = proximos
      .map((x) => ({
        user_id: x.c.owner_id,
        task_id: null,
        tipo: "gasto_fijo",
        texto: `Pago fijo por vencer: ${x.c.concepto} (${x.fecha === hoy ? "hoy" : "mañana"})`,
      }))
      .filter((a) => !yaAvisados.has(`${a.user_id}|${a.texto}`));
    if (avisos.length === 0) return 0;

    const { error: insErr } = await admin.from("notifications").insert(avisos);
    if (insErr) throw insErr;
    return avisos.length;
  } catch (e) {
    /* Si la migración del tipo 'gasto_fijo' no está puesta, el insert truena:
       se loguea y los recordatorios de tareas siguen su curso. */
    console.warn("[recordatorios] gastos fijos no avisados:", e);
    return 0;
  }
}

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

    /* Los avisos de gastos fijos van SIEMPRE, haya o no recordatorios. */
    const gastos = await avisarGastosFijos(admin);

    const filas = pendientes ?? [];
    if (filas.length === 0) {
      /* Aunque no haya recordatorios, este barrido es la red de seguridad del
         push: si el despacho falló al comentar o al asignar (servidor caído,
         timeout del servicio de push), aquí se recoge lo pendiente. */
      const push = await despacharPushPendientes();
      return NextResponse.json({ ok: true, enviados: 0, gastos, push });
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

    return NextResponse.json({ ok: true, enviados: filas.length, gastos, push });
  } catch (e) {
    return respuestaError(e, "tareas recordatorios", "Falló el envío de recordatorios.");
  }
}
