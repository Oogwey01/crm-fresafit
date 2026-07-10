import { createClient } from "@/lib/supabase/server";
import { PanelInventario } from "@/components/inventario/panel";
import type { ProductConProveedor, Supplier, SupplierOrderConDetalle, RolId } from "@/lib/types";

export const metadata = { title: "Inventario · Fresafit" };

export default async function InventarioPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [productosRes, proveedoresRes, pedidosRes, perfilRes] = await Promise.all([
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
    user
      ? supabase.from("profiles").select("rol").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
  ]);

  const productos = (productosRes.data ?? []) as unknown as ProductConProveedor[];
  const proveedores = (proveedoresRes.data ?? []) as Supplier[];
  const pedidos = (pedidosRes.data ?? []) as unknown as SupplierOrderConDetalle[];
  const rol = ((perfilRes.data as { rol?: RolId } | null)?.rol ?? "miembro") as RolId;

  return <PanelInventario productos={productos} proveedores={proveedores} pedidos={pedidos} rol={rol} />;
}
