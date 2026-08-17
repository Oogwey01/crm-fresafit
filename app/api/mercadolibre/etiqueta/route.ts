import { NextResponse } from "next/server";
import { exigirRol } from "@/lib/supabase/guardia";
import { conexionMercadolibre, mlFetch } from "@/lib/mercadolibre/api";

/* La etiqueta de envío de Mercado Libre, lista para imprimir.

   Antes de esto, imprimir una guía era: abrir el panel de ML, buscar la orden,
   entrar al detalle y darle a imprimir — pedido por pedido. La API entrega el
   mismo PDF directo por id de envío (`sales.envio_id`, lo deja la sync), así
   que el botón de la guía en /pedidos llama a esta ruta y sale la etiqueta.

   ESTO NO ES UNA LECTURA, y aquí decía que sí lo era. Para Mercado Libre,
   entregar el PDF ES el acto de imprimir: sella `date_first_printed` y mueve el
   envío a `printed` y de ahí a `ready_for_pickup`. Es decir, esta ruta CAMBIA EL
   ESTADO DEL ENVÍO en la cuenta del canal — anuncia que el paquete está listo
   para que pase la colecta—, aunque en la bodega no se haya empacado nada.

   El 17/08/2026 se descubrió con un cinturón del día 14 que amaneció "Listo
   para recolección" sin que bodega hubiera tocado su guía. Por eso quien la
   llama (components/pedidos/panel.tsx) pide confirmación explícita y ya no es
   un enlace: un `<a href>` es un GET, y un GET lo dispara el navegador solo.

   No le aplica el candado de `CANALES_SOLO_LECTURA` porque ese candado protege
   el STOCK (ver ARQUITECTURA.md), pero conviene saber que este es el único
   punto del CRM que mueve algo en un canal, y que lo hace de verdad.

   La sesión es la del CRM (cookie), por eso el PDF se abre en una pestaña. */
export async function GET(request: Request) {
  const cx = await exigirRol("interno");
  if ("error" in cx) return NextResponse.json({ error: cx.error }, { status: 401 });

  const envio = new URL(request.url).searchParams.get("envio")?.trim() ?? "";
  if (!/^\d+$/.test(envio)) {
    return NextResponse.json({ error: "Falta el número de envío." }, { status: 400 });
  }

  const ml = await conexionMercadolibre();
  if (!ml) {
    return NextResponse.json({ error: "Mercado Libre no está conectado." }, { status: 409 });
  }

  const res = await mlFetch(ml, `/shipment_labels?shipment_ids=${envio}&response_type=pdf`);
  if (!res.ok) {
    /* ML rechaza la etiqueta cuando el envío no está en un estado imprimible
       (ya entregado, cancelado, o todavía sin preparar). Se pasa su motivo tal
       cual: es más útil que un genérico. */
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null;
    return NextResponse.json(
      {
        error:
          detalle?.message ??
          "Mercado Libre no entregó la etiqueta. Revisa el estado del envío en su panel.",
      },
      { status: res.status === 401 || res.status === 403 ? 502 : res.status },
    );
  }

  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etiqueta-${envio}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
