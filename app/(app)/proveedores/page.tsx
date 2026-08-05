import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { esDireccion } from "@/lib/catalogos";
import { traerTodo } from "@/lib/canales/paginacion";
import { paramsReordenDesdeEnv } from "@/lib/inventario/reabastecimiento";
import { PanelProveedores } from "@/components/proveedores/panel";
import type { Product, Supplier, SupplierOrderConDetalle } from "@/lib/types";

export const metadata = { title: "Proveedores · Fresafit" };

/* A quién le compramos y qué le pedimos.

   Salió de Inventario porque son dos preguntas distintas —cuánto tengo / a
   quién le compro— y juntas hacían una pantalla de seis pestañas. Es SOLO de
   dirección: lleva costos de compra, condiciones de proveedor y los pagos de
   cada pedido. La RLS ya lo acota; este corte es para que nadie llegue a una
   pantalla vacía sin entender por qué. */
export default async function ProveedoresPage() {
  const { supabase, rol } = await usuarioActual();
  if (!esDireccion(rol)) redirect("/inventario");

  const [proveedoresRes, pedidosRes] = await Promise.all([
    supabase.from("suppliers").select("*").order("nombre"),
    /* Techo explícito. Cada pedido arrastra sus renglones y el producto de cada
       renglón, así que la respuesta crece por dos lados a la vez y sin límite se
       iba a hacer más pesada cada mes para mostrar siempre lo mismo. 300 pedidos
       ordenados de más nuevo a más viejo son varios años al ritmo actual —se
       hacen unos pocos al mes— y, sobre todo, cubren de sobra lo único que la
       pantalla necesita completo: los que siguen abiertos o en camino, que por
       definición son los recientes. Lo que se queda fuera es historia cerrada.
       El número va escrito aquí y no heredado del corte mudo de PostgREST en
       1000, que además llegaría con el payload ya inflado. */
    supabase
      .from("supplier_orders")
      .select(
        "*, proveedor:suppliers!proveedor_id(id, nombre), items:supplier_order_items(*, producto:products!producto_id(id, nombre, variante))",
      )
      .order("fecha_pedido", { ascending: false })
      .limit(300),
  ]);

  /* Catálogo liviano: solo lo que necesitan el diálogo de pedido y los
     importadores para emparejar SKUs. Nada del peso de /inventario. */
  const productos = await traerTodo<ProductoLigeroProv>((desde, hasta) =>
    supabase
      .from("products")
      .select("id, nombre, variante, sku, costo, activo, proveedor_id")
      .order("nombre")
      .range(desde, hasta),
  );

  return (
    <PanelProveedores
      proveedores={(proveedoresRes.data ?? []) as Supplier[]}
      pedidos={(pedidosRes.data ?? []) as SupplierOrderConDetalle[]}
      productos={productos}
      diasEntregaDefault={paramsReordenDesdeEnv().diasEntregaDefault}
    />
  );
}

export type ProductoLigeroProv = Pick<
  Product,
  "id" | "nombre" | "variante" | "sku" | "costo" | "activo" | "proveedor_id"
>;
