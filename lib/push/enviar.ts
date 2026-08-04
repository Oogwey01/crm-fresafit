/* ============================================================================
   lib/push/enviar.ts — Despacho de avisos push a los dispositivos
   ----------------------------------------------------------------------------
   Los avisos del CRM los crean TRIGGERS dentro de Postgres (asignación de tarea,
   comentario) y una ruta de cron (recordatorios). Ninguno de ellos puede hablar
   con los servidores de push de Google o Apple, así que el despacho vive aquí:
   una función que barre los avisos con `push_enviado_at is null`, los empuja a
   los dispositivos de cada destinatario y los marca.

   Se llama justo después de las acciones que generan avisos (comentar, asignar)
   para que lleguen al instante, y también desde el cron como red de seguridad:
   si un despacho falla, el siguiente barrido lo recoge.

   Solo servidor (service role + clave privada VAPID).
   ============================================================================ */

import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

/* Ventana de rescate: un aviso más viejo que esto ya no se empuja. Si el push
   estuvo caído dos días, nadie quiere que le lleguen de golpe cuarenta avisos de
   cosas que ya resolvió; los sigue viendo en la campana del CRM. */
const HORAS_VIGENCIA = 12;

/* De una sentada: los avisos pendientes son unos pocos salvo tras una caída. */
const MAX_POR_BARRIDO = 200;

type Aviso = {
  id: string;
  user_id: string;
  task_id: string | null;
  tipo: string;
  texto: string;
};

type Suscripcion = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/* Las claves VAPID identifican al CRM ante los servidores de push. Sin ellas el
   despacho simplemente no ocurre (y se dice en el log): es preferible a que la
   app truene por una variable de entorno que falta. */
function configurado(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  /* El "subject" es un contacto para los operadores del push (Google, Apple,
     Mozilla), no para el equipo: es a donde escriben si el CRM les da problemas.
     La especificación lo exige, así que hay un valor por defecto para que un
     despliegue sin la variable siga funcionando. */
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:rene@fresafit.com.mx",
    pub,
    priv,
  );
  return true;
}

/* Título y cuerpo de la tarjeta que verá la persona. El texto que guardan los
   triggers ya viene redactado ("Ana comentó en «X»: …"); aquí solo se parte en
   dos líneas para que la notificación no sea un párrafo. */
function contenido(aviso: Aviso): { titulo: string; cuerpo: string } {
  const porTipo: Record<string, string> = {
    asignacion: "Nueva tarea para ti",
    comentario: "Nuevo comentario",
    recordatorio: "Recordatorio",
    atorado: "Tarea atorada",
  };
  return { titulo: porTipo[aviso.tipo] ?? "Fresafit CRM", cuerpo: aviso.texto };
}

/* Empuja los avisos pendientes. Devuelve cuántos se despacharon y a cuántos
   dispositivos. Nunca lanza: un fallo de push no debe tumbar la acción que lo
   originó (comentar una tarea tiene que funcionar aunque el push no). */
export async function despacharPushPendientes(): Promise<{
  avisos: number;
  envios: number;
  bajas: number;
}> {
  const vacio = { avisos: 0, envios: 0, bajas: 0 };
  if (!configurado()) return vacio;

  try {
    const admin = createAdminClient();
    const desde = new Date(Date.now() - HORAS_VIGENCIA * 3600_000).toISOString();

    const { data: avisosData, error } = await admin
      .from("notifications")
      .select("id, user_id, task_id, tipo, texto")
      .is("push_enviado_at", null)
      .gte("created_at", desde)
      .order("created_at", { ascending: true })
      .limit(MAX_POR_BARRIDO);
    if (error) throw new Error(error.message);

    const avisos = (avisosData ?? []) as Aviso[];
    if (avisos.length === 0) return vacio;

    /* Todo lo pendiente se marca al final, incluso lo que no tenía a quién
       mandarse: si alguien no tiene ningún dispositivo suscrito, su aviso no
       queda dando vueltas para siempre en la cola. */
    const marcar = avisos.map((a) => a.id);

    const destinatarios = [...new Set(avisos.map((a) => a.user_id))];
    const { data: subsData, error: errSubs } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", destinatarios);
    if (errSubs) throw new Error(errSubs.message);

    const porUsuario = new Map<string, Suscripcion[]>();
    for (const s of (subsData ?? []) as Suscripcion[]) {
      const lista = porUsuario.get(s.user_id) ?? [];
      lista.push(s);
      porUsuario.set(s.user_id, lista);
    }

    const caducadas: string[] = [];
    const vivas: string[] = [];
    let envios = 0;

    /* En paralelo: son llamadas a servidores externos y un barrido puede tener
       decenas. En serie, una suscripción lenta retrasa a todas las demás. */
    await Promise.all(
      avisos.flatMap((aviso) => {
        const subs = porUsuario.get(aviso.user_id) ?? [];
        const { titulo, cuerpo } = contenido(aviso);
        const carga = JSON.stringify({
          titulo,
          cuerpo,
          url: aviso.task_id ? `/tareas/${aviso.task_id}` : "/tareas",
          /* Colapsar por tarea: veinte comentarios seguidos en la misma tarea
             son un aviso que se actualiza, no veinte tarjetas apiladas. */
          tag: aviso.task_id ? `tarea-${aviso.task_id}` : undefined,
          persistente: aviso.tipo === "asignacion",
        });

        return subs.map(async (s) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              carga,
              { TTL: HORAS_VIGENCIA * 3600 },
            );
            envios++;
            vivas.push(s.id);
          } catch (e) {
            /* 404/410 = el navegador desinstaló la suscripción (se limpió el
               sitio, se desinstaló la PWA). Se borra: reintentarla siempre es
               trabajo perdido y ruido en los logs. */
            const status = (e as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) caducadas.push(s.id);
            else console.error("[push] envío fallido:", status ?? e);
          }
        });
      }),
    );

    const ahora = new Date().toISOString();
    await Promise.all([
      admin.from("notifications").update({ push_enviado_at: ahora }).in("id", marcar),
      vivas.length > 0
        ? admin
            .from("push_subscriptions")
            .update({ ultimo_uso_at: ahora })
            .in("id", [...new Set(vivas)])
        : Promise.resolve(),
      caducadas.length > 0
        ? admin.from("push_subscriptions").delete().in("id", caducadas)
        : Promise.resolve(),
    ]);

    return { avisos: avisos.length, envios, bajas: caducadas.length };
  } catch (e) {
    console.error("[push] barrido:", e);
    return vacio;
  }
}
