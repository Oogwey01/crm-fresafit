import { NextResponse } from "next/server";
import { autorizarOAuth } from "@/lib/canales/http";
import { guardarConexionML, intercambiarCodigoML } from "@/lib/mercadolibre/api";
import { importacionCompletaML } from "@/lib/mercadolibre/sync";

/* Callback del OAuth de Mercado Libre: cambia el código por los tokens
   (access de 6 h + refresh de un solo uso), los guarda e importa el catálogo.
   Las notificaciones NO se registran aquí: se configuran en el DevCenter. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const rechazo = await autorizarOAuth(request);
  if (rechazo) return rechazo;

  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/inventario?mercadolibre=error`);

  try {
    const tokens = await intercambiarCodigoML(code);
    await guardarConexionML(tokens);
    const resumen = await importacionCompletaML({
      token: tokens.access_token,
      userId: String(tokens.user_id),
    });
    return NextResponse.redirect(
      `${origin}/inventario?mercadolibre=conectada&items=${resumen.items}&vinculados=${resumen.vinculados}`,
    );
  } catch (e) {
    console.error("[mercadolibre] callback:", e);
    return NextResponse.redirect(`${origin}/inventario?mercadolibre=error`);
  }
}
