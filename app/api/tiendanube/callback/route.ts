import { NextResponse } from "next/server";
import { autorizarOAuth, basePublica } from "@/lib/canales/http";
import { guardarConexion, intercambiarCodigo, registrarWebhooksTN } from "@/lib/tiendanube/api";
import { sincronizacionCompleta } from "@/lib/tiendanube/sync";

/* Callback del OAuth de Tienda Nube: cambia el código (válido 5 minutos) por
   el access token, lo guarda, registra los webhooks e importa el catálogo. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const rechazo = await autorizarOAuth(request);
  if (rechazo) return rechazo;

  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/inventario?tiendanube=error`);

  try {
    const { token, storeId } = await intercambiarCodigo(code);
    await guardarConexion(token, storeId);

    // Tienda Nube solo acepta webhooks en URLs https públicas; sin base
    // pública se omiten (el cron /api/tiendanube/sync los registra después).
    let webhooks = "ok";
    const base = basePublica(origin);
    if (base) {
      try {
        await registrarWebhooksTN({ token, storeId }, base);
      } catch (e) {
        console.error("[tiendanube] registro de webhooks:", e);
        webhooks = "pendientes";
      }
    } else {
      webhooks = "pendientes";
    }

    const resumen = await sincronizacionCompleta({ token, storeId });
    return NextResponse.redirect(
      `${origin}/inventario?tiendanube=conectada&productos=${resumen.productos}&webhooks=${webhooks}`,
    );
  } catch (e) {
    console.error("[tiendanube] callback:", e);
    return NextResponse.redirect(`${origin}/inventario?tiendanube=error`);
  }
}
