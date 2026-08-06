import type { Product } from "@/lib/types";

/* Lo único que el módulo de proveedores necesita saber de un producto: para
   emparejar SKUs al pegar un pedido, proponer el costo y contar cuántas fichas
   trae cada proveedor.

   Es un tipo aparte —y no `ProductConProveedor`— porque esta pantalla no carga
   el catálogo entero de Inventario: sin fotos, sin stock por canal, sin los 90
   días de ventas. `ProductConProveedor` sigue encajando aquí (tiene todos estos
   campos), así que Inventario puede seguir pasando el suyo donde haga falta.

   Vivía en components/proveedores/tipos.ts, que obligaba a `app/` a importar
   un tipo de dominio desde la capa que lo pinta. */
export type ProductoLigeroProv = Pick<
  Product,
  "id" | "nombre" | "variante" | "sku" | "activo" | "proveedor_id"
>;

export type ProductoProveedor = ProductoLigeroProv & {
  /* Opcional porque no sale de `products`: la columna está fuera del alcance del
     token y llega desde la vista `producto_costos` (ver 20260902000000). Aquí
     siempre viene —el módulo es de dirección—, pero el tipo lo refleja. */
  costo?: number | null;
};
