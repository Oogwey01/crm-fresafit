import { NextResponse } from "next/server";
import { autorizarOAuth } from "@/lib/canales/http";
import { urlAutorizacionTikTok } from "@/lib/tiktok/api";

/* Arranque del OAuth de TikTok Shop. Solo producción: la redirect_uri
   registrada en el Partner Center debe ser https y coincidir exacta
   (TIKTOK_REDIRECT_URI). */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const rechazo = await autorizarOAuth(request);
  if (rechazo) return rechazo;
  if (!process.env.TIKTOK_APP_KEY || !process.env.TIKTOK_REDIRECT_URI) {
    return NextResponse.redirect(`${origin}/inventario?tiktok=error`);
  }
  return NextResponse.redirect(urlAutorizacionTikTok());
}
