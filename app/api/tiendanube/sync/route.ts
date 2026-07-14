import { NextResponse } from "next/server";
import { usuarioActual, esInterno } from "@/lib/supabase/usuario-actual";
import { conexionTiendanube, registrarWebhooksTN } from "@/lib/tiendanube/api";
import { sincronizacionCompleta } from "@/lib/tiendanube/sync";
import { importarVentasTN } from "@/lib/tiendanube/ventas";

/* Reconciliación completa del catálogo + ventas recientes. La dispara el cron
   diario de Vercel (Authorization: Bearer CRON_SECRET) o un usuario interno. */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const esCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!esCron) {
    const { user, rol } = await usuarioActual();
    if (!user || !esInterno(rol)) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
  }

  const cx = await conexionTiendanube();
  if (!cx) return NextResponse.json({ error: "Tienda Nube no está conectada." }, { status: 409 });

  // Autocuración: con URL https pública, asegura los webhooks registrados
  // (cubre el caso de haber conectado desde localhost antes del deploy).
  const { origin } = new URL(request.url);
  if (origin.startsWith("https://") && !origin.includes("localhost")) {
    try {
      await registrarWebhooksTN(cx, origin);
    } catch (e) {
      console.error("[tiendanube] registro de webhooks:", e);
    }
  }

  try {
    const resumen = await sincronizacionCompleta(cx);
    // Red de seguridad de ventas: reimporta la ventana reciente por si algún
    // webhook de orden se perdió. Su fallo no tira la sync de catálogo.
    let ventas = null;
    try {
      ventas = await importarVentasTN(cx);
    } catch (e) {
      console.error("[tiendanube] importación de ventas:", e);
    }
    return NextResponse.json({ ok: true, ...resumen, ventas });
  } catch (e) {
    console.error("[tiendanube] sync:", e);
    const detalle = e instanceof Error ? e.message : "Falló la sincronización.";
    return NextResponse.json({ error: detalle }, { status: 500 });
  }
}
