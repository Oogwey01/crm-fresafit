import { NextResponse } from "next/server";
import {
  autorizarCron,
  conActorDePeticion,
  opcionesReimportacion,
  respuestaError,
} from "@/lib/canales/http";
import { conexionMercadolibre } from "@/lib/mercadolibre/api";
import { importacionCompletaML } from "@/lib/mercadolibre/sync";
import { importarVentasML } from "@/lib/mercadolibre/ventas";

/* Los 300s por defecto de Vercel alcanzan para el cron diario pero no para un
   reimporte con `?dias=` grande: la info de envío se pide POR ORDEN y una
   ventana de 45 días ya se quedaba a medias (FUNCTION_INVOCATION_TIMEOUT). */
export const maxDuration = 800;

/* Reconciliación completa con Mercado Libre. La dispara el cron diario de
   Vercel a las 6:30 UTC — media hora DESPUÉS del de Tienda Nube, a propósito:
   cada full-sync adopta y propaga solo diferencias, así que el orden TN→ML
   repara webhooks perdidos de ambos lados y converge en una corrida. */
export async function GET(request: Request) {
  const noAutorizado = await autorizarCron(request);
  if (noAutorizado) return noAutorizado;

  const cx = await conexionMercadolibre();
  if (!cx) return NextResponse.json({ error: "Mercado Libre no está conectado." }, { status: 409 });

  try {
    const resumen = await conActorDePeticion(request, () => importacionCompletaML(cx));
    // Red de seguridad de ventas: reimporta la ventana reciente por si algún
    // webhook de orden se perdió. Su fallo no tira la sync de catálogo.
    let ventas = null;
    try {
      ventas = await importarVentasML(cx, opcionesReimportacion(request));
    } catch (e) {
      console.error("[mercadolibre] importación de ventas:", e);
    }
    return NextResponse.json({ ok: true, ...resumen, ventas });
  } catch (e) {
    return respuestaError(e, "mercadolibre sync", "Falló la sincronización.");
  }
}
