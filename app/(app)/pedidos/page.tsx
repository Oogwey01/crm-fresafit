import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { diasDesdeHoy } from "@/lib/fecha";
import { PanelPedidos } from "@/components/pedidos/panel";
import type { PedidoEnvio, RolId } from "@/lib/types";

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
    /* Solo las columnas que pinta la tabla y el diálogo de envío: con `*` la
       respuesta pesaba 819 KB contra 474 KB, y esos bytes viajan al navegador. */
    .select(
      "id, fecha, canal, cantidad, estado, num_guia, paqueteria, descripcion," +
        " producto:products!producto_id(id, nombre, variante)," +
        " cliente:customers!cliente_id(id, nombre)",
    )
    .not("estado", "is", null)
    .gte("fecha", diasDesdeHoy(-DIAS_VENTANA))
    .order("fecha", { ascending: false })
    .limit(5000);

  const pedidos = (pedidosRes.data ?? []) as unknown as PedidoEnvio[];

  return <PanelPedidos pedidos={pedidos} rol={rol} />;
}
