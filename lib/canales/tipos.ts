/* Vocabulario compartido de canales. El mismo canal tiene DOS nombres que no
   son intercambiables: el slug corto (carpetas de lib/, rutas de API, tabla
   `integraciones`) y el canal de venta (columna `canal` de `sales` y de los
   ledgers de stock). Antes cada módulo declaraba su propia unión y su propio
   mapeo — llegó a haber tres copias del mismo tipo con tres nombres — y el
   traductor slug↔canal_venta estaba repetido a mano en tres lugares. */

export type Canal = "tiendanube" | "mercadolibre" | "tiktok";

/* De dónde vino un movimiento de stock: un canal, o el propio CRM. */
export type OrigenStock = Canal | "crm";

/* slug → canal de venta ("tiendanube" → "tienda_nube"). */
export const SLUG_A_CANAL_VENTA = {
  tiendanube: "tienda_nube",
  mercadolibre: "mercado_libre",
  tiktok: "tiktok_shop",
} as const satisfies Record<Canal, string>;

export type CanalVenta = (typeof SLUG_A_CANAL_VENTA)[Canal];

/* canal de venta → slug ("tienda_nube" → "tiendanube"). */
export const CANAL_VENTA_A_SLUG = {
  tienda_nube: "tiendanube",
  mercado_libre: "mercadolibre",
  tiktok_shop: "tiktok",
} as const satisfies Record<CanalVenta, Canal>;

/* ---------------------------------------------------------------------------
   Formas que arman las páginas de canales y pasan a sus paneles. Vivían
   exportadas DESDE los componentes y las importaba `app/`, que es la
   dependencia al revés: la página construía el dato pero el tipo era del
   componente que lo pinta.
   --------------------------------------------------------------------------- */

/* Resultado de un redirect de OAuth (?tiendanube=… / ?mercadolibre=… /
   ?tiktok=…), ya traducido a algo que se le pueda enseñar a una persona. */
export type AvisoConexion = { tipo: "ok" | "error" | "info"; mensaje: string };

/* Cuánto pesa un canal en el periodo. */
export type PesoCanal = {
  /* Null = quien mira no ve el dinero de este canal. */
  monto: number | null;
  piezas: number;
  renglones: number;
  /* Qué porcentaje del negocio entró por aquí en el periodo. Null también para
     el encargado del canal: es una división entre el total de TODOS, así que
     enseñarla junto al vendido de su canal deja despejar la venta de los demás. */
  participacion: number | null;
  dias: number;
};

/* Lo que se queda el canal por vender: comisión y flete sobre la venta. */
export type CostosCanal = {
  venta: number;
  comision: number;
  /* Lo que cuesta el flete al vendedor: en Mercado Libre el comprador suele
     pagar 0 y esta parte sí sale de la cuenta. */
  flete: number;
  /* Comisión + flete sobre la venta. */
  tasa: number;
  ordenes: number;
  dias: number;
};
