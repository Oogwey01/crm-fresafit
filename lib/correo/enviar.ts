/* ============================================================================
   lib/correo/enviar.ts — Salida de correo (Resend)
   ----------------------------------------------------------------------------
   El CRM avisaba por dos canales: la campana de adentro y el push de la PWA.
   Los dos suponen que la persona entra al CRM. Con el módulo de empresas eso deja
   de ser cierto: a la gente de Nutravia hay que poder alcanzarla donde ya
   trabaja, que es su correo, o el módulo termina donde empezó — en WhatsApp.

   Se habla con la API de Resend por `fetch`, sin SDK: es una llamada POST con un
   JSON, y el resto de las integraciones del CRM (Tienda Nube, Mercado Libre,
   TikTok) están escritas igual. Una dependencia menos que actualizar.

   SIN LLAVE NO TRUENA. Si falta `RESEND_API_KEY` —el entorno local de alguien,
   una preview, el día antes de verificar el dominio— se anota en consola y se
   sigue: el aviso in-app y el push ya salieron, y ninguna acción del CRM debe
   fallar porque el correo no esté configurado.

   Configuración (una vez):
     RESEND_API_KEY   la llave del proyecto en Resend
     CORREO_FROM      remitente verificado, p. ej. "Fresafit <crm@fresafit.com.mx>"
     CORREO_BASE_URL  a dónde apuntan los enlaces del correo (la URL pública del
                      CRM). Sin ella los botones del mensaje no llevan a ningún
                      lado, así que el correo sale sin ellos.
   ============================================================================ */

const API = "https://api.resend.com/emails";

export type CorreoSalida = {
  para: string | string[];
  asunto: string;
  html: string;
  /* Alternativa en texto plano. Va siempre: sin ella hay clientes de correo —y
     filtros de spam— que tratan el mensaje con menos cariño. */
  texto?: string;
};

/* La URL pública del CRM, para los enlaces de los correos. Se prefiere la
   explícita: `VERCEL_URL` es la del DEPLOYMENT (cambia en cada push) y mandarla
   en un correo es dejar enlaces que envejecen en la bandeja de alguien. */
export function baseDelCorreo(): string | null {
  const explicita = process.env.CORREO_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (explicita) return explicita.replace(/\/$/, "");
  return null;
}

export async function enviarCorreo(msg: CorreoSalida): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.CORREO_FROM;

  if (!key || !from) {
    console.warn(
      "[correo] sin RESEND_API_KEY o CORREO_FROM: no se manda «%s». El aviso in-app y el push sí salieron.",
      msg.asunto,
    );
    return { ok: false, error: "correo no configurado" };
  }

  const destinatarios = (Array.isArray(msg.para) ? msg.para : [msg.para]).filter(Boolean);
  if (!destinatarios.length) return { ok: false, error: "sin destinatario" };

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: destinatarios,
        subject: msg.asunto,
        html: msg.html,
        ...(msg.texto ? { text: msg.texto } : {}),
      }),
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      console.warn("[correo] Resend respondió %s: %s", res.status, detalle.slice(0, 300));
      return { ok: false, error: `Resend ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    /* Un correo que no sale no puede tumbar la acción que lo disparó. */
    console.warn("[correo] no se pudo enviar:", e instanceof Error ? e.message : e);
    return { ok: false, error: "fallo de red" };
  }
}

/* Manda varios de una, en paralelo y sin que uno arrastre a los demás. Devuelve
   cuántos salieron, que es lo que el cron reporta en su respuesta. */
export async function enviarCorreos(mensajes: CorreoSalida[]): Promise<number> {
  if (!mensajes.length) return 0;
  const res = await Promise.all(mensajes.map((m) => enviarCorreo(m)));
  return res.filter((r) => r.ok).length;
}
