import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { leerDatosIntegracion } from "@/lib/canales/integraciones";
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
     flujo de envío quedan fuera).

     Solo las columnas que pinta la tabla y el diálogo de envío: con `*` la
     respuesta pesaba 819 KB contra 474 KB, y esos bytes viajan al navegador.

     Esta consulta iba doblada en `conColumnasOpcionales` mientras las
     migraciones de dirección y rastreo (20260807000000_direccion_envio.sql,
     20260809000000_rastreo_pedidos.sql y 20260811000000_url_orden.sql) estaban
     recién escritas y podían faltar en la base. Ya se aplicaron —son anteriores
     a las de Bodega e Influencers, que llevan tiempo corriendo en producción—,
     así que se pide directo: el andamiaje solo servía para repetir la consulta
     entera cuando fallaba, o sea el doble de costo justo cuando algo va mal. */
  const [pedidosRes, datosTN] = await Promise.all([
    supabase
      .from("sales")
      .select(
        "id, fecha, canal, cantidad, estado, num_guia, paqueteria, descripcion," +
          " referencia_externa, envio_direccion, url_rastreo, url_orden," +
          " producto:products!producto_id(id, nombre, variante)," +
          " cliente:customers!cliente_id(id, nombre)",
      )
      .not("estado", "is", null)
      .gte("fecha", diasDesdeHoy(-DIAS_VENTANA))
      .order("fecha", { ascending: false })
      .limit(5000),
    /* El panel de Tienda Nube vive en el subdominio de cada tienda, así que el
       enlace "ver la orden en el canal" necesita ese dato. Lo deja la sync en
       `integraciones.datos`; si aún no ha corrido, el enlace simplemente no
       aparece para Tienda Nube (Mercado Libre y TikTok no lo necesitan). */
    leerDatosIntegracion("tiendanube").catch(() => ({}) as Record<string, unknown>),
  ]);

  const pedidos = (pedidosRes.data ?? []) as unknown as PedidoEnvio[];
  const dominioTN =
    typeof datosTN.dominio_admin === "string" ? datosTN.dominio_admin : null;

  return <PanelPedidos pedidos={pedidos} rol={rol} dominioTiendaNube={dominioTN} />;
}
