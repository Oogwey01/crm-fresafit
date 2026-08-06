import type { Product } from "@/lib/types";

/* Lo que el módulo de influencers necesita de un producto: para elegir qué
   material se le entregó a cada quien. Sin stock ni canales — esta pantalla no
   carga el catálogo de Inventario.

   Vivía exportado desde components/influencers/panel.tsx, que obligaba a `app/`
   a importar un tipo de dominio desde la capa que lo pinta. */
export type ProductoLigero = Pick<Product, "id" | "nombre" | "variante" | "sku"> & {
  /* El precio solo viaja para quien ve los ingresos (ver vistaDinero). */
  precio?: number | null;
};
