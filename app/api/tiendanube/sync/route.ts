import { NextResponse } from "next/server";
import {
  autorizarCron,
  basePublica,
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

  // Autocuración: asegura los webhooks apuntando a la base pública (cubre el
  // caso de haber conectado desde localhost, y corrige URLs de deployment
  // registradas por error). El alta es idempotente: PUT si la URL no coincide.
  const base = basePublica(new URL(request.url).origin);
  if (base) {
    try {
      await registrarWebhooksTN(cx, base);
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
