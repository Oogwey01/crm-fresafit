import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizarCron, respuestaError } from "@/lib/canales/http";
import { despacharPushPendientes } from "@/lib/push/enviar";
import { correosDe } from "@/lib/correo/avisos";
import { baseDelCorreo, enviarCorreos, type CorreoSalida } from "@/lib/correo/enviar";
import {
  correoDocumentoPorVencer,
  correoResumenDiario,
  correoTareaVencida,
} from "@/lib/correo/plantillas";
import {
  DIAS_AVISO_VENCIMIENTO,
  ESTADOS_CERRADOS,
  obtenerCategoriaDocumento,
} from "@/lib/catalogos";
import { hoyISO } from "@/lib/fecha";

/* ============================================================================
   El barrido diario del módulo de empresas
   ----------------------------------------------------------------------------
   Tres cosas que solo se pueden saber mirando el reloj, y por eso ninguna cabe
   en una acción del CRM:

     1. Documentos que pierden vigencia dentro de 30 días. Es la razón de ser de
        la fecha de vigencia: una constancia caducada frena una factura, y nadie
        entra al CRM a revisar fechas.
     2. Tareas compartidas que ya pasaron su fecha límite. Avisa a LAS DOS
        PARTES —a quien la pidió y a quien la debe— porque el aviso sirve
        justamente para no tener que hacer la llamada incómoda.
     3. El resumen del día para la gente de fuera: lo que se abrió y lo que
        venció. Lo urgente ya salió en el momento (ver lib/correo/avisos.ts); esto
        recoge el resto para no mandarles un correo por cada movimiento.

   NO va en vercel.json: los tres crons del plan Hobby están ocupados por las
   sincronizaciones de canales. Lo dispara cron-job.org una vez al día con
   `Authorization: Bearer <CRON_SECRET>`, y la ruta va en RUTAS_PUBLICAS del
   proxy (valida adentro; sin credencial responde 401).

   Idempotente: los avisos de vencimiento se sellan con `aviso_vencimiento_en` y
   los de tarea vencida se comprueban contra las notificaciones del día, así que
   dispararlo dos veces no manda nada dos veces.
   ============================================================================ */

export async function GET(request: Request) {
  const noAutorizado = await autorizarCron(request);
  if (noAutorizado) return noAutorizado;

  try {
    const admin = createAdminClient();
    const hoy = hoyISO();
    const base = baseDelCorreo();

    /* Las empresas activas y su gente: se necesita en los tres barridos, así
       que se lee una vez. */
    const [{ data: empresas }, { data: contactos }] = await Promise.all([
      admin.from("agencia_empresas").select("id, nombre, slug").eq("activa", true),
      admin.from("profiles").select("id, nombre, empresa_id").not("empresa_id", "is", null),
    ]);

    const porEmpresa = new Map((empresas ?? []).map((e) => [e.id, e]));
    const gentePorEmpresa = new Map<string, { id: string; nombre: string }[]>();
    for (const c of contactos ?? []) {
      if (!c.empresa_id) continue;
      const lista = gentePorEmpresa.get(c.empresa_id) ?? [];
      lista.push({ id: c.id, nombre: c.nombre });
      gentePorEmpresa.set(c.empresa_id, lista);
    }

    const mensajes: CorreoSalida[] = [];

    /* ---- 1) Documentos por vencer --------------------------------------- */
    const limite = new Date(Date.parse(`${hoy}T12:00:00Z`) + DIAS_AVISO_VENCIMIENTO * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const { data: porVencer } = await admin
      .from("empresa_documentos")
      .select("id, empresa_id, nombre, categoria, vigente_hasta, visibilidad, created_by")
      .not("vigente_hasta", "is", null)
      .lte("vigente_hasta", limite)
      .is("archivado_at", null)
      /* El sello: sin él, este correo saldría todos los días durante un mes. */
      .is("aviso_vencimiento_en", null);

    const documentos = porVencer ?? [];
    for (const d of documentos) {
      const empresa = porEmpresa.get(d.empresa_id ?? "");
      if (!empresa) continue;

      const dias = Math.round(
        (Date.parse(`${d.vigente_hasta}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86_400_000,
      );

      /* Al equipo que atiende la cuenta siempre; al cliente solo si el documento
         es suyo de ver — avisarle de que caduca algo que no sabe que existe es
         confundirlo. */
      const equipo = await asignadosDe(admin, d.empresa_id ?? "");
      const destinatarios = [...equipo];
      if (d.visibilidad === "compartido") {
        destinatarios.push(...(gentePorEmpresa.get(d.empresa_id ?? "") ?? []).map((p) => p.id));
      }
      if (!destinatarios.length) continue;

      await admin.from("notifications").insert(
        [...new Set(destinatarios)].map((uid) => ({
          user_id: uid,
          tipo: "recordatorio",
          texto: `${d.nombre} (${empresa.nombre}) vence en ${dias} ${dias === 1 ? "día" : "días"}.`,
        })),
      );

      const correos = await correosDe([...new Set(destinatarios)]);
      const msg = correoDocumentoPorVencer({
        nombre: d.nombre,
        empresa: empresa.nombre,
        categoria: obtenerCategoriaDocumento(d.categoria)?.nombre ?? "documento",
        vigenteHasta: d.vigente_hasta!,
        dias,
        url: base ? `${base}/agencia/clientes/${empresa.slug}` : null,
      });
      for (const correo of correos.values()) {
        mensajes.push({ para: correo, asunto: msg.asunto, html: msg.html, texto: msg.texto });
      }

      await admin
        .from("empresa_documentos")
        .update({ aviso_vencimiento_en: new Date().toISOString() })
        .eq("id", d.id);
    }

    /* ---- 2) Tareas compartidas vencidas --------------------------------- */
    const { data: vencidas } = await admin
      .from("tasks")
      .select("id, titulo, empresa_id, fecha_limite, responsable_id, created_by")
      .eq("espacio", "agencia")
      .eq("visibilidad", "compartido")
      .not("fecha_limite", "is", null)
      .lt("fecha_limite", hoy)
      .not("estado", "in", `(${ESTADOS_CERRADOS.join(",")})`)
      .is("deleted_at", null);

    const tareasVencidas = vencidas ?? [];
    if (tareasVencidas.length) {
      /* Un solo aviso por tarea y por día: se comprueba contra lo ya insertado
         hoy en vez de sellar una columna nueva en `tasks`. La tabla de
         notificaciones ya tiene el dato y se purga sola a los 90 días. */
      const desdeHoy = `${hoy}T00:00:00.000Z`;
      const { data: yaAvisadas } = await admin
        .from("notifications")
        .select("task_id")
        .eq("tipo", "recordatorio")
        .gte("created_at", desdeHoy)
        .in(
          "task_id",
          tareasVencidas.map((t) => t.id),
        );
      const avisadas = new Set((yaAvisadas ?? []).map((n) => n.task_id));

      const avisos: { user_id: string; task_id: string; tipo: string; texto: string }[] = [];
      for (const t of tareasVencidas) {
        if (avisadas.has(t.id)) continue;
        const empresa = porEmpresa.get(t.empresa_id ?? "");
        const partes = [...new Set([t.responsable_id, t.created_by].filter(Boolean))] as string[];
        for (const uid of partes) {
          avisos.push({
            user_id: uid,
            task_id: t.id,
            tipo: "recordatorio",
            texto: `Venció: ${t.titulo}${empresa ? ` (${empresa.nombre})` : ""}`,
          });
        }

        if (empresa) {
          const correos = await correosDe(partes);
          const nombreResponsable =
            (contactos ?? []).find((c) => c.id === t.responsable_id)?.nombre ?? "Fresafit";
          const msg = correoTareaVencida({
            titulo: t.titulo,
            empresa: empresa.nombre,
            fechaLimite: t.fecha_limite!,
            responsable: nombreResponsable,
            url: base ? `${base}/agencia/clientes/${empresa.slug}` : null,
          });
          for (const correo of correos.values()) {
            mensajes.push({ para: correo, asunto: msg.asunto, html: msg.html, texto: msg.texto });
          }
        }
      }
      if (avisos.length) await admin.from("notifications").insert(avisos);
    }

    /* ---- 3) El resumen del día para cada cliente ------------------------ */
    const ayer = new Date(Date.now() - 86_400_000).toISOString();
    for (const [empresaId, gente] of gentePorEmpresa) {
      const empresa = porEmpresa.get(empresaId);
      if (!empresa || !gente.length) continue;

      const { data: nuevas } = await admin
        .from("tasks")
        .select("titulo, created_by, prioridad")
        .eq("espacio", "agencia")
        .eq("empresa_id", empresaId)
        .eq("visibilidad", "compartido")
        .gte("created_at", ayer)
        .is("deleted_at", null);

      /* Lo urgente ya se mandó en el momento: repetirlo en el resumen le quita
         significado a la palabra. */
      const delDia = (nuevas ?? []).filter((t) => t.prioridad !== "urgente");
      const vencidasDeEsta = tareasVencidas.filter((t) => t.empresa_id === empresaId);

      const msg = correoResumenDiario({
        empresa: empresa.nombre,
        nuevas: delDia.map((t) => ({
          titulo: t.titulo,
          solicitante:
            (contactos ?? []).find((c) => c.id === t.created_by)?.nombre ?? "Fresafit",
        })),
        vencidas: vencidasDeEsta.map((t) => ({ titulo: t.titulo, fechaLimite: t.fecha_limite! })),
        url: base ? `${base}/portal/tareas` : null,
      });
      if (!msg) continue; // sin novedades no se manda nada

      const correos = await correosDe(gente.map((p) => p.id));
      for (const correo of correos.values()) {
        mensajes.push({ para: correo, asunto: msg.asunto, html: msg.html, texto: msg.texto });
      }
    }

    const enviados = await enviarCorreos(mensajes);
    const push = await despacharPushPendientes();

    return NextResponse.json({
      ok: true,
      documentosPorVencer: documentos.length,
      tareasVencidas: tareasVencidas.length,
      correos: enviados,
      push,
    });
  } catch (e) {
    return respuestaError(e, "cron portal", "Falló el barrido del módulo de empresas.");
  }
}

/* Quién de Fresafit atiende a esta empresa. Sin asignaciones no se avisa a
   nadie del equipo: mejor ningún correo que uno a todo el CRM. */
async function asignadosDe(
  admin: ReturnType<typeof createAdminClient>,
  empresaId: string,
): Promise<string[]> {
  if (!empresaId) return [];
  const { data } = await admin
    .from("agencia_asignaciones")
    .select("profile_id")
    .eq("empresa_id", empresaId)
    .eq("activo", true);
  return (data ?? []).map((a) => a.profile_id);
}
