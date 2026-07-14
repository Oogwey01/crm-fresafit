import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";
import { conexionTiendanube, obtenerProductoTN } from "@/lib/tiendanube/api";
import { desactivarProductoTN, sincronizarProductosTN } from "@/lib/tiendanube/sync";
import { procesarOrdenTN } from "@/lib/tiendanube/ventas";

/* Receptor de webhooks de Tienda Nube (product/* y order/paid|cancelled).
   Exigen un 2XX en menos de 3 segundos, así que se responde de inmediato y el
   trabajo corre con after(). Pueden llegar duplicados: no estorban porque la
   sincronización es un upsert idempotente. */
export async function POST(request: Request) {
  const secreto = process.env.TIENDANUBE_CLIENT_SECRET;
  if (!secreto) return NextResponse.json({ error: "Integración no configurada." }, { status: 503 });

  // Firma HMAC-SHA256 del cuerpo crudo con el client secret de la app.
  const crudo = await request.text();
  const firma = Buffer.from(request.headers.get("x-linkedstore-hmac-sha256") ?? "");
  const esperada = Buffer.from(createHmac("sha256", secreto).update(crudo, "utf8").digest("hex"));
  if (firma.length !== esperada.length || !timingSafeEqual(firma, esperada)) {
    return NextResponse.json({ error: "Firma inválida." }, { status: 401 });
  }

  let evento: { store_id?: number | string; event?: string; id?: number };
  try {
    evento = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const { event, id } = evento;
  // Evento que no manejamos: 200 para que Tienda Nube no lo reintente.
  const esProducto = !!event?.startsWith("product/");
  const esOrden = event === "order/paid" || event === "order/cancelled";
  if ((!esProducto && !esOrden) || typeof id !== "number") {
    return NextResponse.json({ ok: true });
  }

  after(async () => {
    try {
      const cx = await conexionTiendanube();
      if (!cx || String(evento.store_id) !== cx.storeId) return;
      if (esOrden) {
        // Alta o retiro de la venta según el estado real de la orden.
        await procesarOrdenTN(id);
      } else if (event === "product/deleted") {
        await desactivarProductoTN(id);
      } else {
        // El payload solo trae el id; los datos frescos se piden a la API.
        const producto = await obtenerProductoTN(cx, id);
        if (producto) await sincronizarProductosTN([producto]);
        else await desactivarProductoTN(id); // lo borraron entre aviso y consulta
      }
    } catch (e) {
      console.error(`[tiendanube] webhook ${event} ${id}:`, e);
    }
  });

  return NextResponse.json({ ok: true });
}
