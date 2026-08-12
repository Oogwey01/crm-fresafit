import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { catalogoProveedores } from "@/lib/supabase/consultas";
import type { ProductoLigeroProv, ProductoReordenProv } from "@/lib/proveedores/tipos";
import { adjuntarCostos } from "@/lib/supabase/montos";
import { esDireccion } from "@/lib/catalogos";
import { traerTodo } from "@/lib/canales/paginacion";
import { diasDesdeHoy } from "@/lib/fecha";
import {
  paramsReordenDesdeEnv,
  type EnCamino,
  type VentaReorden,
} from "@/lib/inventario/reabastecimiento";
import { PanelProveedores } from "@/components/proveedores/panel";
import type { SupplierOrderConDetalle } from "@/lib/types";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";

export const metadata = { title: "Proveedores · Fresafit" };

/* Ventana máxima de ventas que se manda al panel; «Qué pedir» la recorta a
   30/60/90 días sin volver al servidor. La misma que usa Inventario. */
const DIAS_VENTAS = 90;

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

  const [proveedores, pedidosRes, productos, ventasRes, enCaminoRes] = await Promise.all([
    catalogoProveedores(),
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
    /* Catálogo liviano: lo que necesitan el diálogo de pedido y los importadores
       para emparejar SKUs, MÁS lo que pide el cálculo de reorden de «Qué pedir»
       (stock, tipo, vigencia y dónde está publicada la ficha). Sigue sin traer
       las fotos ni el resto del peso de /inventario. Paginado con traerTodo
       porque PostgREST corta en ~1000 filas sin avisar y el catálogo ya ronda
       ese techo.
       El costo llega por `producto_costos`: la columna está fuera del alcance
       del token (ver 20260902000000). Aquí siempre se pide —este módulo es de
       dirección de punta a punta—, pero se pide por la puerta que valida.
       Catálogo→costo es en serie por naturaleza (los ids salen del catálogo),
       pero la cadena entera corre a la par de las otras consultas. */
    traerTodo<ProductoLigeroProv>((desde, hasta) =>
      supabase
        .from("products")
        .select(
          "id, nombre, variante, sku, activo, proveedor_id, tipo, stock, bajo_pedido, descontinuado, meli_item_id, meli_logistic_type, meli_stock_full, tiendanube_variant_id, tiktok_product_id",
        )
        .order("nombre")
        .range(desde, hasta),
    ).then((catalogo) => adjuntarCostos(supabase, catalogo, true)),
    /* Ventas de la ventana: la velocidad de salida de cada producto. Agregadas
       por día/canal/producto en la base (RPC ventas_reorden), que es la
       granularidad que usa el cálculo: mismo resultado, muchas menos filas que
       bajar cada venta. Los cancelados no cuentan (dentro de la RPC). */
    supabase.rpc("ventas_reorden", { desde: diasDesdeHoy(-DIAS_VENTAS) }),
    /* Unidades pedidas a proveedor que aún no llegan, para no volver a pedir lo
       que ya viene en camino. Va por RPC y no leyendo supplier_order_items
       porque esa tabla devuelve costo y proveedor, que aquí no hacen falta. */
    supabase.rpc("unidades_en_camino"),
  ]);

  /* El proveedor de cada ficha se resuelve contra el catálogo que ya viajó en
     este mismo Promise.all, en vez de embeberlo en el select: el join anidado
     repetiría el nombre y los días de entrega en cada una de las ~1130 filas. */
  const provPorId = new Map(proveedores.map((p) => [p.id, p]));
  const productosReorden: ProductoReordenProv[] = productos.map((p) => ({
    ...p,
    proveedor: (p.proveedor_id && provPorId.get(p.proveedor_id)) || null,
  }));

  /* La RPC ya viene agrupada por producto y filtrada por estado. */
  const enCamino: EnCamino = {};
  for (const f of (enCaminoRes.data ?? []) as { producto_id: string; unidades: number }[]) {
    enCamino[f.producto_id] = Number(f.unidades);
  }

  return (
    <PanelProveedores
      proveedores={proveedores}
      pedidos={(pedidosRes.data ?? []) as SupplierOrderConDetalle[]}
      productos={productos}
      productosReorden={productosReorden}
      ventas={(ventasRes.data ?? []) as unknown as VentaReorden[]}
      enCamino={enCamino}
      paramsReorden={paramsReordenDesdeEnv()}
      diasEntregaDefault={paramsReordenDesdeEnv().diasEntregaDefault}
    />
  );
}
