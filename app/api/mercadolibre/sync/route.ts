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
    /* Las VENTAS van primero: son la red de seguridad que cuadra el dinero
       (reimporta la ventana reciente y marca las órdenes canceladas por si
       algún webhook se perdió). La reconciliación de catálogo llegó a comerse
       los 300s de Vercel ella sola, y con el orden invertido la mitad de
       ventas llevaba días sin ejecutarse (sello del 10/08 un 13/08). Un fallo
       de ventas tampoco tira la sync de catálogo. */
    let ventas = null;
    try {
      ventas = await importarVentasML(cx, opcionesReimportacion(request));
    } catch (e) {
      console.error("[mercadolibre] importación de ventas:", e);
    }
    const resumen = await conActorDePeticion(request, () => importacionCompletaML(cx));
    return NextResponse.json({ ok: true, ...resumen, ventas });
  } catch (e) {
    return respuestaError(e, "mercadolibre sync", "Falló la sincronización.");
  }
}
