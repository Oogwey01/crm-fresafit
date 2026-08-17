import { NextResponse, after } from "next/server";
import { conexionMercadolibre, obtenerEnvioML } from "@/lib/mercadolibre/api";
import { sincronizarItemML } from "@/lib/mercadolibre/sync";
import { procesarOrdenML } from "@/lib/mercadolibre/ventas";

/* Receptor de notificaciones de Mercado Libre (tópicos `items`, `orders_v2` y
   `shipments`, configurados en el DevCenter). ML exige un 200 en menos de 500 ms
   y NO firma el payload: se responde de inmediato y el aviso solo dice QUÉ
   revisar — los datos se re-consultan siempre a la API con nuestro token (jamás
   se confía en el cuerpo). Duplicados y reintentos no estorban: la sync es
   idempotente.

   `shipments` se escucha porque casi todo lo que le importa a bodega pasa en el
   ENVÍO, no en la orden: que se imprima la etiqueta, que el paquete quede listo
   para la colecta, que salga. Sin este tópico esos cambios solo se veían en el
   cron diario, y un paquete despachado a las 10 de la mañana seguía marcado como
   "Preparando" hasta la madrugada siguiente. El aviso trae el envío; la orden a
   la que pertenece se pregunta a la API (`/shipments/{id}` responde `order_id`)
   y de ahí se reusa el mismo camino de siempre. */
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
  const envioId =
    body?.topic === "shipments" ? body.resource?.match(/^\/shipments\/(\d+)$/)?.[1] : undefined;
  if (!deNuestraApp || (!itemId && !ordenId && !envioId)) return NextResponse.json({ ok: true });

  after(async () => {
    try {
      const cx = await conexionMercadolibre();
      if (!cx || String(body!.user_id) !== cx.userId) return;
      if (itemId) await sincronizarItemML(itemId);
      else if (ordenId) await procesarOrdenML(ordenId);
      else if (envioId) {
        /* Un envío sin orden identificable no es un error: ML avisa de envíos
           que aún no cuajaron en venta. Se ignora en silencio. */
        const envio = await obtenerEnvioML(cx, envioId);
        if (envio?.order_id) await procesarOrdenML(envio.order_id);
      }
    } catch (e) {
      console.error(
        `[mercadolibre] notificación ${body?.topic} ${itemId ?? ordenId ?? envioId}:`,
        e,
      );
    }
  });

  return NextResponse.json({ ok: true });
}
