import { NextResponse } from "next/server";
import { autorizarOAuth } from "@/lib/canales/http";
import { urlAutorizacion } from "@/lib/tiendanube/api";

/* Arranque del OAuth: manda al usuario a autorizar la app en Tienda Nube.
   Al aceptar, Tienda Nube redirige a /api/tiendanube/callback con el código. */
export async function GET(request: Request) {
  const rechazo = await autorizarOAuth(request);
  if (rechazo) return rechazo;
  return NextResponse.redirect(urlAutorizacion());
}
