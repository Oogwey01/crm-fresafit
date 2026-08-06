import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { traerTodo } from "@/lib/canales/paginacion";
import { saludML } from "@/lib/canales/salud";
import { estadoMercadolibre } from "@/lib/mercadolibre/api";
import { agruparDespachos, instanteDeCorte, resumirDespachos } from "@/lib/mercadolibre/desempeno";
import { diasDesdeHoy } from "@/lib/fecha";
import { PanelMercadoLibre } from "@/components/canales/panel-mercadolibre";
import type { VentaDespacho } from "@/lib/types";

export const metadata = { title: "Mercado Libre · Fresafit" };

/* Ventana del tablero de despacho. La métrica de Mercado Libre mira 60 días,
   pero lo accionable es lo reciente: un pedido de hace dos meses ya no se puede
   despachar a tiempo. 30 días alcanza para ver si la semana va mejor. */
const DIAS_DESPACHO = 30;

/* Ventana de los costos. Más larga que la del despacho: la comisión no se mira
   para reaccionar hoy, sino para saber cuánto rinde el canal. */
const DIAS_COMISION = 60;

export default async function MercadoLibrePage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase } = await usuarioActual();

  /* Lo que se queda Mercado Libre sale ahora de `costos_canal`, y no de leer
     `sale_orders` a pelo: esa tabla es dinero de arriba abajo y quedó cerrada a
     dirección, así que una consulta directa le devolvería cero filas al
     encargado del canal —que es justo quien tiene que ver esto—. La función
     decide por dentro, con el mismo filtro de siempre (solo las órdenes que
     traen comisión) y devuelve null si quien pregunta no puede verlo. */
  type FilaCostos = {
    ordenes: number;
    total: number;
    comision: number;
    costo_envio: number;
  } | null;

  const [ventas, salud, estado, costosRes] = await Promise.all([
    /* Solo lo que puede terminar en el tablero: renglones CON plazo y SIN
       despachar. Antes bajaban los 30 días completos —miles de renglones—
       para que `agruparDespachos` tirara casi todos: los sin plazo se saltan
       (situacionDespacho da null) y los ya despachados («tarde»/«cumplido»)
       no entran en `resumirDespachos`, que solo cuenta pendientes. El filtro
       en la base deja la misma pantalla con una fracción del payload.

       Paginado con traerTodo: el `.limit(3000)` que llevaba no protegía de
       nada —PostgREST corta en ~1000 SIN error— y justo un pico de rezago,
       cuando más pendientes hay, es cuando el tablero no puede mentir. */
    traerTodo<VentaDespacho>((desde, hasta) =>
      supabase
        .from("sales")
        .select(
          "id, fecha, cantidad, descripcion, estado, num_guia, url_orden," +
            " referencia_externa, envio_limite_despacho, envio_despachado_en",
        )
        .eq("canal", "mercado_libre")
        .gte("fecha", diasDesdeHoy(-DIAS_DESPACHO))
        .not("envio_limite_despacho", "is", null)
        .is("envio_despachado_en", null)
        .order("fecha", { ascending: false })
        .order("id")
        .range(desde, hasta) as unknown as PromiseLike<{
        data: VentaDespacho[] | null;
        error: { message: string } | null;
      }>,
    ),
    /* Si Mercado Libre no contesta, el resto de la página sigue en pie. */
    saludML(),
    estadoMercadolibre(),
    supabase.rpc("costos_canal", {
      canal_f: "mercado_libre",
      desde: diasDesdeHoy(-DIAS_COMISION),
    }),
  ]);

  const crudo = costosRes.data as FilaCostos;
  const ventaConDato = Number(crudo?.total ?? 0);
  const cargos = Number(crudo?.comision ?? 0) + Number(crudo?.costo_envio ?? 0);
  const costos =
    crudo && crudo.ordenes > 0
      ? {
          venta: Math.round(ventaConDato * 100) / 100,
          comision: Math.round(Number(crudo.comision) * 100) / 100,
          flete: Math.round(Number(crudo.costo_envio) * 100) / 100,
          /* La tasa es sobre TODO lo que se va, no solo la comisión: es lo que
             de verdad separa el precio de venta de lo que queda. */
          tasa: ventaConDato > 0 ? (cargos / ventaConDato) * 100 : 0,
          ordenes: crudo.ordenes,
          dias: DIAS_COMISION,
        }
      : null;

  /* Un solo instante para toda la pantalla: si cada fila leyera la hora por su
     cuenta, dos pedidos con el mismo plazo podrían salir clasificados distinto. */
  const ahora = instanteDeCorte();
  const despachos = agruparDespachos(ventas, ahora);

  return (
    <PanelMercadoLibre
      salud={salud}
      conectada={estado.conectada}
      ultimaSync={estado.ultimaSync}
      resumen={resumirDespachos(despachos)}
      costos={costos}
      dias={DIAS_DESPACHO}
      ahora={ahora}
    />
  );
}
