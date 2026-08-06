import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { leerDatosIntegracion } from "@/lib/canales/integraciones";
import { diasDesdeHoy } from "@/lib/fecha";
import { instanteDeCorte } from "@/lib/mercadolibre/desempeno";
import { ESTADOS_PEDIDO_PENDIENTES } from "@/lib/catalogos";
import { COLUMNAS_PEDIDO, DIAS_VENTANA_PEDIDOS } from "@/lib/pedidos/consulta";
import { PanelPedidos } from "@/components/pedidos/panel";
import type { PedidoEnvio, RolId } from "@/lib/types";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";

export const metadata = { title: "Pedidos · Fresafit" };

export default async function PedidosPage() {
  await exigirModulo("pedidos");
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  /* Solo lo que AÚN DA TRABAJO: nuevo, preparando, enviado. Antes viajaban los
     120 días completos —hasta 5.000 renglones, ~474 KB— y el 95% eran pedidos
     ya entregados que nadie iba a mirar al abrir. El histórico (entregados y
     cancelados de la misma ventana) lo pide el panel al cambiar de filtro, con
     `listarPedidosHistorico`. Las ventas históricas sin flujo de envío (estado
     null) siguen fuera, como siempre.

     Esta consulta iba doblada en `conColumnasOpcionales` mientras las
     migraciones de dirección y rastreo estaban recién escritas y podían faltar
     en la base. Ya se aplicaron, así que se pide directo. */
  const [pedidosRes, datosTN] = await Promise.all([
    supabase
      .from("sales")
      .select(COLUMNAS_PEDIDO)
      .in("estado", [...ESTADOS_PEDIDO_PENDIENTES])
      .gte("fecha", diasDesdeHoy(-DIAS_VENTANA_PEDIDOS))
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

  return (
    <PanelPedidos
      pedidos={pedidos}
      rol={rol}
      dominioTiendaNube={dominioTN}
      ahora={instanteDeCorte()}
    />
  );
}
