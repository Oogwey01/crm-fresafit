import { NextResponse, after } from "next/server";
import { procesarOrdenTikTok } from "@/lib/tiktok/ventas";
import { sincronizarProductoTikTok } from "@/lib/tiktok/sync";

/* Receptor de notificaciones de TikTok Shop (configuradas en el Partner Center).
   El aviso solo dice QUÉ revisar; los datos se re-consultan siempre a la API con
   nuestro token (nunca se confía en el cuerpo), así que un cuerpo falso a lo más
   provoca una lectura de más. Duplicados no estorban: la sync es idempotente.
   Se responde 200 de inmediato y el trabajo corre con after(). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    type?: number | string;
    shop_id?: string;
    data?: { order_id?: string; product_id?: string };
  } | null;

  const orderId = body?.data?.order_id;
  const productId = body?.data?.product_id;
  if (!orderId && !productId) return NextResponse.json({ ok: true });

  after(async () => {
    try {
      if (orderId) await procesarOrdenTikTok(String(orderId));
      else if (productId) await sincronizarProductoTikTok(String(productId));
    } catch (e) {
      console.error(`[tiktok] webhook ${orderId ?? productId}:`, e);
    }
  });

  return NextResponse.json({ ok: true });
}
