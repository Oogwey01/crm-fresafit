import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { diasDesdeHoy } from "@/lib/fecha";
import { PanelPedidos } from "@/components/pedidos/panel";
import type { RolId, SaleConDetalle } from "@/lib/types";

export const metadata = { title: "Pedidos · Fresafit" };

/* Ventana amplia: un pedido pendiente puede ser de hace semanas. */
const DIAS_VENTANA = 120;

export default async function PedidosPage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  /* Solo filas con estado = las que son "pedido" (las ventas históricas sin
     flujo de envío quedan fuera). */
  const pedidosRes = await supabase
    .from("sales")
    .select(
      "*, producto:products!producto_id(id, nombre, variante), cliente:customers!cliente_id(id, nombre)",
    )
    .not("estado", "is", null)
    .gte("fecha", diasDesdeHoy(-DIAS_VENTANA))
    .order("fecha", { ascending: false })
    .limit(5000);

  const pedidos = (pedidosRes.data ?? []) as unknown as SaleConDetalle[];

  return <PanelPedidos pedidos={pedidos} rol={rol} />;
}
