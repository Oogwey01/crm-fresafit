import { NextResponse } from "next/server";
import { autorizarOAuth } from "@/lib/canales/http";
import { urlAutorizacionML } from "@/lib/mercadolibre/api";

/* Arranque del OAuth de Mercado Libre. Solo funciona contra producción: la
   redirect_uri registrada en el DevCenter debe ser https y coincidir exacta
   (MELI_REDIRECT_URI). */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const rechazo = await autorizarOAuth(request);
  if (rechazo) return rechazo;
  if (!process.env.MELI_CLIENT_ID || !process.env.MELI_REDIRECT_URI) {
    return NextResponse.redirect(`${origin}/inventario?mercadolibre=error`);
  }
  return NextResponse.redirect(urlAutorizacionML());
}
