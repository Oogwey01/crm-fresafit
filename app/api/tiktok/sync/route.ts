import { NextResponse } from "next/server";
import {
  autorizarCron,
  conActorDePeticion,
  opcionesReimportacion,
  respuestaError,
} from "@/lib/canales/http";
import { conexionTiktok } from "@/lib/tiktok/api";
import { importacionCompletaTikTok } from "@/lib/tiktok/sync";
import { importarVentasTikTok } from "@/lib/tiktok/ventas";

/* Reconciliación completa (catálogo + ventas) de TikTok Shop. La dispara el
   cron diario de Vercel (Authorization: Bearer CRON_SECRET) o un interno. */
export async function GET(request: Request) {
  const noAutorizado = await autorizarCron(request);
  if (noAutorizado) return noAutorizado;

  const cx = await conexionTiktok();
  if (!cx) return NextResponse.json({ error: "TikTok Shop no está conectado." }, { status: 409 });

  /* Catálogo y ventas son independientes: que falle uno no debe impedir el otro.
     La API de TikTok devuelve errores internos transitorios (36009003) en
     /products/search con cierta frecuencia, y hasta ahora eso abortaba la ruta
     entera — el cron diario se quedaba sin importar ventas por un fallo que no
     tenía nada que ver con ellas. */
  let resumen: Awaited<ReturnType<typeof importacionCompletaTikTok>> | null = null;
  let errorCatalogo: string | null = null;
  try {
    resumen = await conActorDePeticion(request, () => importacionCompletaTikTok(cx));
  } catch (e) {
    errorCatalogo = e instanceof Error ? e.message : "Falló la sincronización del catálogo.";
    console.error("[tiktok] sincronización de catálogo:", e);
  }

  let ventas = null;
  let errorVentas: string | null = null;
  try {
    ventas = await importarVentasTikTok(cx, opcionesReimportacion(request));
  } catch (e) {
    errorVentas = e instanceof Error ? e.message : "Falló la importación de ventas.";
    console.error("[tiktok] importación de ventas:", e);
  }

  // Solo es un fallo de verdad si se cayeron las DOS mitades.
  if (errorCatalogo && errorVentas) {
    return respuestaError(new Error(errorCatalogo), "tiktok sync", "Falló la sincronización.");
  }
  return NextResponse.json({
    ok: true,
    ...(resumen ?? {}),
    ventas,
    ...(errorCatalogo ? { error_catalogo: errorCatalogo } : {}),
    ...(errorVentas ? { error_ventas: errorVentas } : {}),
  });
}
