/* Enlaces a la publicación de un producto en cada canal, para saltar del CRM
   a la ficha de la plataforma sin buscarla a mano. */

/* Publicación de Mercado Libre (pública). Manda el `permalink` que entrega la
   API (lo guarda la sync en products.meli_permalink): es la URL exacta, con el
   slug del título y el sufijo -_JM. Sin él —fichas que la sync no ha vuelto a
   tocar— se arma la forma corta MLM-<id>-_JM, que es el mismo permalink con el
   slug vacío. OJO: el id pelón (MLM-<id>, sin -_JM) ya NO resuelve: ML lo
   redirige al listado de la categoría. Solo ids mexicanos (MLM…), que es lo
   único que publica la tienda. */
export function urlPublicacionML(
  itemId: string,
  permalink?: string | null,
): string | null {
  const directa = permalink?.trim();
  if (directa) return directa;
  if (!/^MLM\d+$/.test(itemId)) return null;
  return `https://articulo.mercadolibre.com.mx/${itemId.replace(/^MLM/, "MLM-")}-_JM`;
}

/* Publicación de ML en la Central de Vendedores (la vista de VENDEDOR). Aterriza
   en el listado de publicaciones con la búsqueda prellenada con el id: la URL
   del detalle (/publicaciones/<id>/modificar/bomni/…) lleva un token que genera
   el propio panel y no se puede armar desde fuera —armada a mano da «No pudimos
   encontrar esta página»—. Mismo patrón que las órdenes viejas de ML en
   lib/pedidos/rastreo.ts. Sin sesión, ML redirige al login conservando el
   destino. */
export function urlPublicacionMLVendedor(itemId: string): string {
  return `https://vendedores.mercadolibre.com.mx/publicaciones?search=${encodeURIComponent(itemId)}`;
}

/* Producto en el ADMIN de Tienda Nube (la vista de vendedor). La vista de
   comprador no se puede armar desde el id —lleva el slug— y por eso viaja
   guardada en products.tiendanube_permalink. El panel vive en el subdominio de
   cada tienda; el dominio lo deja la sync en `integraciones.datos.dominio_admin`
   y sin él no hay enlace. */
export function urlPublicacionTN(
  dominioAdmin: string | null | undefined,
  productId: number,
): string | null {
  const dominio = dominioAdmin?.trim();
  return dominio ? `https://${dominio}/admin/v2/products/${productId}` : null;
}

/* Producto en el Seller Center de TikTok Shop. Dominio del seller LOCAL
   mexicano (seller-mx), el mismo del authorize de lib/tiktok/api.ts: el dominio
   global (tiktokglobalshop) es el de los sellers cross-border y manda al login
   de otro portal. Pide sesión iniciada en el Seller Center, como todo el panel. */
export function urlPublicacionTikTok(productId: string): string {
  return `https://seller-mx.tiktok.com/product/edit/${encodeURIComponent(productId)}`;
}
