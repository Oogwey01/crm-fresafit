import type { Product } from "@/lib/types";

/* Lo único que el módulo de proveedores necesita saber de un producto: para
   emparejar SKUs al pegar un pedido, proponer el costo y contar cuántas fichas
   trae cada proveedor.

   Es un tipo aparte —y no `ProductConProveedor`— porque esta pantalla no carga
   el catálogo entero de Inventario: sin fotos, sin stock por canal, sin los 90
   días de ventas. `ProductConProveedor` sigue encajando aquí (tiene todos estos
   campos), así que Inventario puede seguir pasando el suyo donde haga falta. */
export type ProductoProveedor = Pick<
  Product,
  "id" | "nombre" | "variante" | "sku" | "costo" | "activo" | "proveedor_id"
>;
