import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { leerDatosIntegracion } from "@/lib/canales/integraciones";
import { traerTodo } from "@/lib/canales/paginacion";
import { diasDesdeHoy } from "@/lib/fecha";
import { instanteDeCorte } from "@/lib/canales/despacho";
import { ESTADOS_PEDIDO_PENDIENTES } from "@/lib/catalogos";
import { COLUMNAS_PEDIDO, DIAS_VENTANA_PEDIDOS } from "@/lib/pedidos/consulta";
import { leerEnProduccion } from "@/lib/pedidos/produccion";
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
     120 días completos —miles de renglones, ~474 KB— y el 95% eran pedidos
     ya entregados que nadie iba a mirar al abrir. El histórico (entregados y
     cancelados de la misma ventana) lo pide el panel al cambiar de filtro, con
     `listarPedidosHistorico`. Las ventas históricas sin flujo de envío (estado
     null) siguen fuera, como siempre.

     Paginado con traerTodo: un `.limit(5000)` no protege de nada, porque
     PostgREST corta en ~1000 filas SIN error y la temporada con más de mil
     pendientes llegaría incompleta sin que nada lo delate. El `id` de
     desempate es obligatorio: `fecha` se repite entre pedidos importados en
     lote y sin criterio único las tandas duplican o saltan filas. */
  const [pedidos, datosTN] = await Promise.all([
    traerTodo<PedidoEnvio>((desde, hasta) =>
      supabase
        .from("sales")
        .select(COLUMNAS_PEDIDO)
        .in("estado", [...ESTADOS_PEDIDO_PENDIENTES])
        .gte("fecha", diasDesdeHoy(-DIAS_VENTANA_PEDIDOS))
        .order("fecha", { ascending: false })
        .order("id")
        .range(desde, hasta),
    ),
    /* El panel de Tienda Nube vive en el subdominio de cada tienda, así que el
       enlace "ver la orden en el canal" necesita ese dato. Lo deja la sync en
       `integraciones.datos`; si aún no ha corrido, el enlace simplemente no
       aparece para Tienda Nube (Mercado Libre y TikTok no lo necesitan). */
    leerDatosIntegracion("tiendanube").catch(() => ({}) as Record<string, unknown>),
  ]);

  const dominioTN =
    typeof datosTN.dominio_admin === "string" ? datosTN.dominio_admin : null;

  /* Cuáles de esos pedidos hay que FABRICAR antes de empacarlos. Va después y no
     en el Promise.all porque necesita los ids de las ventas que acaban de
     llegar. Si la consulta falla, la pantalla se pinta igual: los
     personalizados se mezclan con el resto como hasta ahora, que es molesto pero
     no es un error que valga tirar la página. */
  const enProduccion = await leerEnProduccion(
    supabase,
    pedidos.map((p) => p.id),
  ).catch((e) => {
    console.error("[pedidos] estado de producción:", e);
    return {};
  });

  return (
    <PanelPedidos
      pedidos={pedidos}
      rol={rol}
      dominioTiendaNube={dominioTN}
      ahora={instanteDeCorte()}
      enProduccion={enProduccion}
    />
  );
}
