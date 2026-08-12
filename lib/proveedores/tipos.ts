import type { ProductoReorden } from "@/lib/inventario/reabastecimiento";
import type { Product, Supplier } from "@/lib/types";

/* Lo único que el módulo de proveedores necesita saber de un producto: para
   emparejar SKUs al pegar un pedido, proponer el costo, contar cuántas fichas
   trae cada proveedor y calcular el reorden de «Qué pedir».

   Es un tipo aparte —y no `ProductConProveedor`— porque esta pantalla no carga
   el catálogo entero de Inventario: sin fotos ni las fechas de sincronización de
   cada canal. `ProductConProveedor` sigue encajando aquí (tiene todos estos
   campos), así que Inventario puede seguir pasando el suyo donde haga falta.

   Vivía en components/proveedores/tipos.ts, que obligaba a `app/` a importar
   un tipo de dominio desde la capa que lo pinta. */
export type ProductoLigeroProv = Pick<
  Product,
  | "id"
  | "nombre"
  | "variante"
  | "sku"
  | "activo"
  | "proveedor_id"
  /* De aquí para abajo, lo que pide el cálculo de reorden y antes solo cargaba
     Inventario: cuánto hay, dónde está publicado y si la ficha sigue viva. */
  | "tipo"
  | "stock"
  | "bajo_pedido"
  | "descontinuado"
  | "meli_item_id"
  | "meli_logistic_type"
  | "meli_stock_full"
  | "tiendanube_variant_id"
  | "tiktok_product_id"
>;

export type ProductoProveedor = ProductoLigeroProv & {
  /* Opcional porque no sale de `products`: la columna está fuera del alcance del
     token y llega desde la vista `producto_costos` (ver 20260902000000). Aquí
     siempre viene —el módulo es de dirección—, pero el tipo lo refleja. */
  costo?: number | null;
};

/* El mismo producto con su proveedor resuelto, que es lo que «Qué pedir»
   necesita para saber en cuántos días entrega cada uno. No viene embebido de
   PostgREST: la página ya trae el catálogo de proveedores completo y los cruza
   con un Map, que sale más barato que repetir el join por ficha. */
export type ProductoReordenProv = ProductoProveedor & {
  proveedor: Pick<Supplier, "id" | "nombre" | "dias_entrega"> | null;
};

/* El tipo de arriba cumple lo que el cálculo exige; si algún día se le cae una
   columna al `select`, esto lo caza en el build y no en la pantalla. */
const _cumpleReorden: ProductoReordenProv extends ProductoReorden ? true : never = true;
void _cumpleReorden;
