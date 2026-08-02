import { NextResponse } from "next/server";
import { autorizarCron, respuestaError } from "@/lib/canales/http";
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

  try {
    const resumen = await importacionCompletaTikTok(cx);
    // Red de seguridad de ventas: su fallo no tira la sync de catálogo.
    let ventas = null;
    try {
      ventas = await importarVentasTikTok(cx);
    } catch (e) {
      console.error("[tiktok] importación de ventas:", e);
    }
    return NextResponse.json({ ok: true, ...resumen, ventas });
  } catch (e) {
    return respuestaError(e, "tiktok sync", "Falló la sincronización.");
  }
}
