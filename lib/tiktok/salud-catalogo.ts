/* ============================================================================
   lib/tiktok/salud-catalogo.ts — Dónde está partido el catálogo de TikTok
   ----------------------------------------------------------------------------
   TikTok Shop entró al CRM por su lado: sus publicaciones crearon fichas
   PROPIAS en `products` en vez de engancharse a las que ya existían de Tienda
   Nube y Mercado Libre. Hoy ninguna de las 491 fichas con `tiktok_product_id`
   comparte renglón con otro canal.

   El efecto es que la misma prenda vive en dos o tres fichas con el MISMO SKU y
   cada una lleva su propio stock: la venta de TikTok descuenta de la ficha de
   TikTok y la bodega real nunca se entera. Por eso la pantalla no compara
   "stock del CRM contra stock de TikTok" —esa comparación no existe mientras no
   haya vínculo—, sino que enseña qué SKUs están partidos, que es el problema de
   verdad y lo que hay que unificar.

   `tiktok_stock` viene nulo en todas: la sync no lo está trayendo. Se cuenta y
   se dice, en vez de pintar ceros que parecerían "sin existencias".
   ============================================================================ */

import type { Product } from "@/lib/types";

export type FichaCanal = Pick<
  Product,
  | "id"
  | "nombre"
  | "variante"
  | "sku"
  | "precio"
  | "stock"
  | "tiktok_stock"
  | "tiktok_product_id"
  | "tiendanube_product_id"
  | "meli_item_id"
  | "activo"
>;

/* El mismo SKU con dos precios de lista, uno por lado del corte. Es la
   consecuencia cara de tener el catálogo partido: cambiar el precio en Tienda
   Nube no toca la ficha de TikTok, y la diferencia se queda ahí sin que nadie
   la vea. */
export type PrecioDispar = {
  sku: string;
  nombre: string;
  enTikTok: number;
  enOtros: number;
  /* Negativa = en TikTok se vende más barato, que es el caso que cuesta margen. */
  diferencia: number;
};

/* Un SKU cuya mercancía quedó repartida entre varias fichas. */
export type SkuPartido = {
  sku: string;
  enTikTok: FichaCanal[];
  enOtros: FichaCanal[];
  /* Unidades a cada lado del corte. Sumadas serían el stock real si las fichas
     fueran la misma, que es justo lo que hay que arreglar. */
  stockTikTok: number;
  stockOtros: number;
};

export type SaludCatalogoTikTok = {
  /* Fichas del CRM con publicación en TikTok. */
  vinculadas: number;
  activas: number;
  sinSku: number;
  /* Cuántas traen el stock que reporta TikTok. Si es 0, la sync no lo trae. */
  conStockReportado: number;
  /* Fichas de TikTok que además viven en otro canal: el estado deseable. */
  unificadas: number;
  /* SKUs repartidos entre TikTok y otro canal, del que más unidades tiene en
     juego al que menos. */
  partidos: SkuPartido[];
  /* De esos, los que además tienen precio distinto a cada lado. */
  preciosDispares: PrecioDispar[];
  /* Cuántos de los dispares están MÁS BARATOS en TikTok. */
  masBaratosEnTikTok: number;
};

const esDeTikTok = (f: FichaCanal) => !!f.tiktok_product_id;
const esDeOtroCanal = (f: FichaCanal) => !!f.tiendanube_product_id || !!f.meli_item_id;

/* Recibe el catálogo COMPLETO, no solo lo de TikTok: el cruce se hace por SKU y
   para eso hacen falta las fichas del otro lado. */
export function saludCatalogoTikTok(productos: FichaCanal[]): SaludCatalogoTikTok {
  const conTikTok = productos.filter(esDeTikTok);

  const porSku = new Map<string, FichaCanal[]>();
  for (const p of productos) {
    const sku = p.sku?.trim();
    if (!sku) continue;
    const lista = porSku.get(sku) ?? [];
    lista.push(p);
    porSku.set(sku, lista);
  }

  const partidos: SkuPartido[] = [];
  const preciosDispares: PrecioDispar[] = [];

  for (const [sku, fichas] of porSku) {
    const enTikTok = fichas.filter(esDeTikTok);
    /* El otro lado puede ser una ficha de TN/ML o una suelta con el mismo SKU;
       lo que importa es que NO sea la misma fila que la de TikTok. */
    const enOtros = fichas.filter((f) => !esDeTikTok(f) && (esDeOtroCanal(f) || f.stock > 0));
    if (enTikTok.length === 0 || enOtros.length === 0) continue;

    partidos.push({
      sku,
      enTikTok,
      enOtros,
      stockTikTok: enTikTok.reduce((a, f) => a + (f.stock || 0), 0),
      stockOtros: enOtros.reduce((a, f) => a + (f.stock || 0), 0),
    });

    /* Precio de referencia a cada lado: el primero que lo tenga puesto. */
    const pTikTok = enTikTok.find((f) => f.precio != null)?.precio;
    const pOtros = enOtros.find((f) => f.precio != null)?.precio;
    if (pTikTok != null && pOtros != null && Number(pTikTok) !== Number(pOtros)) {
      preciosDispares.push({
        sku,
        nombre: enTikTok[0].nombre,
        enTikTok: Number(pTikTok),
        enOtros: Number(pOtros),
        diferencia: Number(pTikTok) - Number(pOtros),
      });
    }
  }

  /* Primero la brecha más grande: es donde más margen se está dejando. */
  preciosDispares.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));

  /* Primero donde hay más unidades en juego: son las que más cuesta tener mal
     repartidas y las que conviene unificar antes. */
  partidos.sort((a, b) => b.stockTikTok + b.stockOtros - (a.stockTikTok + a.stockOtros));

  return {
    vinculadas: conTikTok.length,
    activas: conTikTok.filter((f) => f.activo).length,
    sinSku: conTikTok.filter((f) => !f.sku?.trim()).length,
    conStockReportado: conTikTok.filter((f) => f.tiktok_stock !== null).length,
    unificadas: conTikTok.filter(esDeOtroCanal).length,
    partidos,
    preciosDispares,
    masBaratosEnTikTok: preciosDispares.filter((p) => p.diferencia < 0).length,
  };
}
