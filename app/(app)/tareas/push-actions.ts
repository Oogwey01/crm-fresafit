"use server";

/* ============================================================================
   Alta y baja de dispositivos para avisos push.
   ----------------------------------------------------------------------------
   El navegador entrega una suscripción (endpoint + dos claves) y aquí se guarda
   contra el usuario de la sesión. Se escribe con el cliente del usuario, no con
   service role: así la RLS es la que garantiza que nadie registre un dispositivo
   a nombre de otro.
   ============================================================================ */

import { exigirRol } from "@/lib/supabase/guardia";
import type { Resultado } from "@/lib/acciones";

export type SuscripcionPush = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function registrarDispositivo(
  sub: SuscripcionPush,
  userAgent: string,
): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno recibe avisos.");
  if ("error" in cx) return cx;

  if (!sub.endpoint || !sub.p256dh || !sub.auth) {
    return { error: "El navegador no entregó una suscripción válida." };
  }

  /* onConflict en endpoint: volver a activar los avisos en el mismo navegador
     renueva las claves en vez de duplicar el dispositivo (el endpoint puede
     conservarse y rotar las claves). */
  const { error } = await cx.supabase.from("push_subscriptions").upsert(
    {
      user_id: cx.user.id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      user_agent: userAgent.slice(0, 300) || null,
    },
    { onConflict: "endpoint" },
  );
  if (error) return { error: error.message };
  return { ok: true };
}

export async function olvidarDispositivo(endpoint: string): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno recibe avisos.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);
  if (error) return { error: error.message };
  return { ok: true };
}

/* Manda un aviso de prueba a los dispositivos de quien lo pide. Es la única
   forma honesta de comprobar que la cadena completa funciona —permiso del
   navegador, suscripción guardada, claves VAPID, servidor de push— sin esperar a
   que alguien te asigne una tarea. */
export async function probarAvisoPush(): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno recibe avisos.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("notifications").insert({
    user_id: cx.user.id,
    tipo: "recordatorio",
    texto: "Prueba de avisos: si ves esto fuera del CRM, ya quedó.",
  });
  if (error) return { error: error.message };

  const { despacharPushPendientes } = await import("@/lib/push/enviar");
  const r = await despacharPushPendientes();
  if (r.envios === 0) {
    return {
      error:
        "El aviso se creó pero no salió a ningún dispositivo. Revisa que los avisos estén activados en este navegador.",
    };
  }
  return { ok: true };
}
