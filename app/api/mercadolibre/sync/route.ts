import { NextResponse } from "next/server";
import { usuarioActual, esInterno } from "@/lib/supabase/usuario-actual";
import { conexionMercadolibre } from "@/lib/mercadolibre/api";
import { importacionCompletaML } from "@/lib/mercadolibre/sync";
import { importarVentasML } from "@/lib/mercadolibre/ventas";

/* Reconciliación completa con Mercado Libre. La dispara el cron diario de
   Vercel a las 6:30 UTC — media hora DESPUÉS del de Tienda Nube, a propósito:
   cada full-sync adopta y propaga solo diferencias, así que el orden TN→ML
   repara webhooks perdidos de ambos lados y converge en una corrida. */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const esCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!esCron) {
    const { user, rol } = await usuarioActual();
    if (!user || !esInterno(rol)) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
  }

  const cx = await conexionMercadolibre();
  if (!cx) return NextResponse.json({ error: "Mercado Libre no está conectado." }, { status: 409 });

  try {
    const resumen = await importacionCompletaML(cx);
    // Red de seguridad de ventas: reimporta la ventana reciente por si algún
    // webhook de orden se perdió. Su fallo no tira la sync de catálogo.
    let ventas = null;
    try {
      ventas = await importarVentasML(cx);
    } catch (e) {
      console.error("[mercadolibre] importación de ventas:", e);
    }
    return NextResponse.json({ ok: true, ...resumen, ventas });
  } catch (e) {
    console.error("[mercadolibre] sync:", e);
    const detalle = e instanceof Error ? e.message : "Falló la sincronización.";
    return NextResponse.json({ error: detalle }, { status: 500 });
  }
}
