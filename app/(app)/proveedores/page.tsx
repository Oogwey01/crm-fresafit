import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { adjuntarCostos } from "@/lib/supabase/montos";
import { esDireccion } from "@/lib/catalogos";
import { traerTodo } from "@/lib/canales/paginacion";
import { paramsReordenDesdeEnv } from "@/lib/inventario/reabastecimiento";
import { PanelProveedores } from "@/components/proveedores/panel";
import type { Product, Supplier, SupplierOrderConDetalle } from "@/lib/types";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";

export const metadata = { title: "Proveedores · Fresafit" };

/* A quién le compramos y qué le pedimos.

   Salió de Inventario porque son dos preguntas distintas —cuánto tengo / a
   quién le compro— y juntas hacían una pantalla de seis pestañas. Es SOLO de
   dirección: lleva costos de compra, condiciones de proveedor y los pagos de
   cada pedido. La RLS ya lo acota; este corte es para que nadie llegue a una
   pantalla vacía sin entender por qué. */
export default async function ProveedoresPage() {
  await exigirModulo("proveedores");
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
  /* El costo llega por `producto_costos`: la columna está fuera del alcance del
     token (ver 20260902000000). Aquí siempre se pide —este módulo es de
     dirección de punta a punta—, pero se pide por la puerta que valida. */
  const catalogo = await traerTodo<ProductoLigeroProv>((desde, hasta) =>
    supabase
      .from("products")
      .select("id, nombre, variante, sku, activo, proveedor_id")
      .order("nombre")
      .range(desde, hasta) as unknown as PromiseLike<{
      data: ProductoLigeroProv[] | null;
      error: { message: string } | null;
    }>,
  );
  const productos = await adjuntarCostos(supabase, catalogo, true);

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
  "id" | "nombre" | "variante" | "sku" | "activo" | "proveedor_id"
>;
