import { NextResponse, after } from "next/server";
import { conexionMercadolibre } from "@/lib/mercadolibre/api";
import { sincronizarItemML } from "@/lib/mercadolibre/sync";

/* Receptor de notificaciones de Mercado Libre (tópico items, configurado en
   el DevCenter). ML exige un 200 en menos de 500 ms y NO firma el payload:
   se responde de inmediato y el aviso solo dice QUÉ item revisar — los datos
   se re-consultan siempre a la API con nuestro token (jamás se confía en el
   cuerpo). Duplicados y reintentos no estorban: la sync es idempotente. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    resource?: string;
    topic?: string;
    user_id?: number | string;
    application_id?: number | string;
  } | null;

  // Filtro barato antes de responder (sin tocar la base). Siempre 200 para
  // que ML no reintente avisos que no nos interesan.
  const esNuestro =
    body?.topic === "items" && String(body.application_id) === process.env.MELI_CLIENT_ID;
  const itemId = body?.resource?.match(/^\/items\/(ML[A-Z]\d+)$/)?.[1];
  if (!esNuestro || !itemId) return NextResponse.json({ ok: true });

  after(async () => {
    try {
      const cx = await conexionMercadolibre();
      if (!cx || String(body.user_id) !== cx.userId) return;
      await sincronizarItemML(itemId);
    } catch (e) {
      console.error(`[mercadolibre] notificación ${itemId}:`, e);
    }
  });

  return NextResponse.json({ ok: true });
}
