import { createClient } from "@/lib/supabase/server";
import { estadoTiendanube } from "@/lib/tiendanube/api";
import { estadoMercadolibre } from "@/lib/mercadolibre/api";
import { PanelInventario } from "@/components/inventario/panel";
import type { ProductConProveedor, Supplier, SupplierOrderConDetalle, RolId, StockLog } from "@/lib/types";

export const metadata = { title: "Inventario · Fresafit" };

export default async function InventarioPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [productosRes, proveedoresRes, pedidosRes, movimientosRes, perfilRes, tiendanube, mercadolibre] =
    await Promise.all([
      supabase
        .from("products")
        .select("*, proveedor:suppliers!proveedor_id(id, nombre)")
        .order("nombre"),
      supabase.from("suppliers").select("*").order("nombre"),
      supabase
        .from("supplier_orders")
        .select(
          "*, proveedor:suppliers!proveedor_id(id, nombre), items:supplier_order_items(*, producto:products!producto_id(id, nombre, variante))",
        )
        .order("fecha_pedido", { ascending: false }),
      // Historial de movimientos de stock (los 300 más recientes).
      supabase
        .from("stock_log")
        .select("*, producto:products!producto_id(nombre, variante)")
        .order("creado_en", { ascending: false })
        .limit(300),
      user
        ? supabase.from("profiles").select("rol").eq("id", user.id).single()
        : Promise.resolve({ data: null }),
      estadoTiendanube(),
      estadoMercadolibre(),
    ]);

  const productos = (productosRes.data ?? []) as unknown as ProductConProveedor[];
  const proveedores = (proveedoresRes.data ?? []) as Supplier[];
  const pedidos = (pedidosRes.data ?? []) as unknown as SupplierOrderConDetalle[];
  const movimientos = (movimientosRes.data ?? []) as unknown as StockLog[];
  const rol = ((perfilRes.data as { rol?: RolId } | null)?.rol ?? "miembro") as RolId;

  return (
    <PanelInventario
      productos={productos}
      proveedores={proveedores}
      pedidos={pedidos}
      movimientos={movimientos}
      rol={rol}
      tiendanube={tiendanube}
      mercadolibre={mercadolibre}
    />
  );
}
