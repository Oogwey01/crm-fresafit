import { NextResponse } from "next/server";
import {
  autorizarCron,
  conActorDePeticion,
  opcionesReimportacion,
  respuestaError,
} from "@/lib/canales/http";
import { conexionTiendanube, registrarWebhooksTN } from "@/lib/tiendanube/api";
import { sincronizacionCompleta } from "@/lib/tiendanube/sync";
import { importarVentasTN } from "@/lib/tiendanube/ventas";

/* Reconciliación completa del catálogo + ventas recientes. La dispara el cron
   diario de Vercel (Authorization: Bearer CRON_SECRET) o un usuario interno. */
export async function GET(request: Request) {
  const noAutorizado = await autorizarCron(request);
  if (noAutorizado) return noAutorizado;

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
    const resumen = await conActorDePeticion(request, () => sincronizacionCompleta(cx));
    // Red de seguridad de ventas: reimporta la ventana reciente por si algún
    // webhook de orden se perdió. Su fallo no tira la sync de catálogo.
    let ventas = null;
    try {
      ventas = await importarVentasTN(cx, opcionesReimportacion(request));
    } catch (e) {
      console.error("[tiendanube] importación de ventas:", e);
    }
    return NextResponse.json({ ok: true, ...resumen, ventas });
  } catch (e) {
    return respuestaError(e, "tiendanube sync", "Falló la sincronización.");
  }
}
