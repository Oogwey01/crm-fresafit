import { NextResponse } from "next/server";
import { usuarioActual, esInterno } from "@/lib/supabase/usuario-actual";
import { conexionTiktok } from "@/lib/tiktok/api";
import { importacionCompletaTikTok } from "@/lib/tiktok/sync";
import { importarVentasTikTok } from "@/lib/tiktok/ventas";

/* Reconciliación completa (catálogo + ventas) de TikTok Shop. La dispara el
   cron diario de Vercel (Authorization: Bearer CRON_SECRET) o un interno. */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const esCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!esCron) {
    const { user, rol } = await usuarioActual();
    if (!user || !esInterno(rol)) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
  }

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
    console.error("[tiktok] sync:", e);
    const detalle = e instanceof Error ? e.message : "Falló la sincronización.";
    return NextResponse.json({ error: detalle }, { status: 500 });
  }
}
