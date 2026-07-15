import { NextResponse, after } from "next/server";
import { conexionMercadolibre } from "@/lib/mercadolibre/api";
import { sincronizarItemML } from "@/lib/mercadolibre/sync";
import { procesarOrdenML } from "@/lib/mercadolibre/ventas";

/* Receptor de notificaciones de Mercado Libre (tópicos `items` y `orders_v2`,
   configurados en el DevCenter). ML exige un 200 en menos de 500 ms y NO firma
   el payload: se responde de inmediato y el aviso solo dice QUÉ revisar — los
   datos se re-consultan siempre a la API con nuestro token (jamás se confía en
   el cuerpo). Duplicados y reintentos no estorban: la sync es idempotente. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    resource?: string;
    topic?: string;
    user_id?: number | string;
    application_id?: number | string;
  } | null;

  // Filtro barato antes de responder (sin tocar la base). Siempre 200 para
  // que ML no reintente avisos que no nos interesan.
  const deNuestraApp = String(body?.application_id) === process.env.MELI_CLIENT_ID;
  const itemId = body?.topic === "items" ? body.resource?.match(/^\/items\/(ML[A-Z]\d+)$/)?.[1] : undefined;
  const ordenId = body?.topic === "orders_v2" ? body.resource?.match(/^\/orders\/(\d+)$/)?.[1] : undefined;
  if (!deNuestraApp || (!itemId && !ordenId)) return NextResponse.json({ ok: true });

  after(async () => {
    try {
      const cx = await conexionMercadolibre();
      if (!cx || String(body!.user_id) !== cx.userId) return;
      if (itemId) await sincronizarItemML(itemId);
      else if (ordenId) await procesarOrdenML(ordenId);
    } catch (e) {
      console.error(`[mercadolibre] notificación ${body?.topic} ${itemId ?? ordenId}:`, e);
    }
  });

  return NextResponse.json({ ok: true });
}
