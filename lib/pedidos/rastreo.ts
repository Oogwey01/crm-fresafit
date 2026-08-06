/* ============================================================================
   lib/pedidos/rastreo.ts — Enlace de seguimiento a partir de la paquetería
   ----------------------------------------------------------------------------
   Los canales entregan la paquetería y el número de guía, pero no una URL de
   rastreo (a diferencia de los pedidos a proveedor, que sí tienen `url_rastreo`
   capturada a mano). Con la guía en la mano había que ir a buscar el sitio de la
   paquetería y pegar el número — que es lo que pedía evitar Armando: "en pedidos
   y envíos también tiene que tener seguimiento, dónde está".

   Es una tabla de correspondencias, no una integración: si la paquetería no está
   en la lista, simplemente no se ofrece enlace (mejor eso que mandar a una URL
   inventada que no lleva a ningún lado).
   ============================================================================ */

/* Cada entrada: fragmentos que pueden aparecer en el nombre que manda el canal
   ("DHL Express MX", "Estafeta Terrestre") y cómo se arma su URL. */
const PAQUETERIAS: { claves: string[]; url: (guia: string) => string }[] = [
  {
    claves: ["dhl"],
    url: (g) => `https://www.dhl.com/mx-es/home/rastreo.html?tracking-id=${g}`,
  },
  {
    claves: ["fedex"],
    url: (g) => `https://www.fedex.com/fedextrack/?trknbr=${g}`,
  },
  {
    /* La URL vieja (/Herramientas/Rastreo?guia=) ya no existe: Estafeta redirige
       a su buscador vacío y se pierde la guía, que era exactamente el trabajo que
       venía a ahorrar. Ésta sí devuelve el resultado directo. */
    claves: ["estafeta"],
    url: (g) =>
      `https://cs.estafeta.com/es/Tracking/searchByGet?wayBill=${g}&wayBillType=0&isShipmentDetail=False`,
  },
  {
    /* Envío Nube (la logística de Tienda Nube) rastrea todo desde envia.com, sea
       cual sea el transportista que ponga el paquete. */
    claves: ["envio nube", "envia", "nuvem envio"],
    url: (g) => `https://envia.com/rastreo?cntry_code=mx&label=${g}`,
  },
  {
    claves: ["ups"],
    url: (g) => `https://www.ups.com/track?loc=es_MX&tracknum=${g}`,
  },
  {
    claves: ["redpack"],
    url: (g) => `https://www.redpack.com.mx/es/rastreo/?guias=${g}`,
  },
  {
    claves: ["paquetexpress", "paquete express"],
    url: (g) => `https://www.paquetexpress.com.mx/rastreo/?guia=${g}`,
  },
  {
    claves: ["99 minutos", "99minutos"],
    url: (g) => `https://99minutos.com/rastreo?tracking=${g}`,
  },
  {
    claves: ["sendex"],
    url: (g) => `https://sendex.mx/rastreo?guia=${g}`,
  },
  {
    claves: ["correos de mexico", "sepomex", "correos"],
    url: (g) => `https://www.correosdemexico.gob.mx/SSLServicios/SeguimientoEnvio/Seguimiento.aspx?guia=${g}`,
  },
  {
    /* Mercado Envíos: el seguimiento vive dentro de la orden de ML, no hay una
       URL pública por guía, así que se manda al panel de ventas. */
    claves: ["mercado envios", "mercadoenvios", "mercado libre"],
    url: () => "https://www.mercadolibre.com.mx/ventas/listado",
  },
];

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/* URL de rastreo. Prioriza la que manda el canal (Tienda Nube la entrega hecha
   en el fulfillment) y solo si no hay, la deriva de la paquetería. Null cuando no
   se reconoce el transportista o falta la guía. */
export function urlRastreo(
  paqueteria: string | null,
  numGuia: string | null,
  urlDelCanal?: string | null,
): string | null {
  const delCanal = urlDelCanal?.trim();
  if (delCanal) return delCanal;
  const guia = numGuia?.trim();
  if (!guia || !paqueteria) return null;
  const nombre = normalizar(paqueteria);
  const match = PAQUETERIAS.find((p) => p.claves.some((c) => nombre.includes(c)));
  return match ? match.url(encodeURIComponent(guia)) : null;
}

/* ---------------------- La orden en el panel del canal -------------------- */

/* Enlace al pedido tal como lo ve el vendedor en la plataforma. Es el atajo para
   lo que el CRM no replica —conversación con el comprador, factura, reclamos— sin
   tener que buscar el número a mano en el panel.

   `referenciaOrden` es la parte de orden de `referencia_externa` (ver
   `numeroOrden` en el panel de pedidos): el CRM guarda una fila por renglón.

   OJO con Mercado Libre: su panel abre el detalle por `pack_id` (el carrito), no
   por el número de orden. Con el número de orden te deja en el listado del día.
   El `pack_id` solo lo da su API, así que el enlace bueno se guarda al importar
   en `sales.url_orden`; esto es el respaldo para las ventas viejas, que al menos
   deja la venta localizada en el buscador del listado.

   Tienda Nube necesita el dominio de la tienda porque su panel vive en el
   subdominio de cada una; llega desde el servidor, que sí lo tiene. */
export function urlOrdenCanal(
  canal: string,
  referenciaOrden: string,
  dominioTiendaNube?: string | null,
  urlGuardada?: string | null,
): string | null {
  const guardada = urlGuardada?.trim();
  if (guardada) return guardada;

  const ref = referenciaOrden.trim();
  if (!ref) return null;
  switch (canal) {
    case "tienda_nube": {
      const dominio = dominioTiendaNube?.trim();
      return dominio ? `https://${dominio}/admin/v2/orders/${encodeURIComponent(ref)}` : null;
    }
    case "mercado_libre":
      return `https://www.mercadolibre.com.mx/ventas/omni/listado?q=${encodeURIComponent(ref)}`;
    case "tiktok_shop":
      /* seller-mx.tiktok.com es el seller center de la tienda mexicana (mismo
         dominio que usa el OAuth, ver lib/tiktok/api.ts). El genérico
         seller.tiktokglobalshop.com aterrizaba en el portal global "de China"
         y ahí la orden no abría. */
      return `https://seller-mx.tiktok.com/order/detail?order_no=${encodeURIComponent(ref)}&shop_region=MX`;
    default:
      // Punto físico, WhatsApp, etc.: no hay panel externo al que ir.
      return null;
  }
}

/* Enlace al detalle de una venta de Mercado Libre. `packId` es el carrito; sin
   él (venta de un solo artículo fuera de carrito) sirve el id de la orden. */
export function urlOrdenML(ordenId: string | number, packId?: string | number | null): string {
  const id = String(packId ?? ordenId);
  return `https://www.mercadolibre.com.mx/ventas/${encodeURIComponent(id)}/detalle`;
}
