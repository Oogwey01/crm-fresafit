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
