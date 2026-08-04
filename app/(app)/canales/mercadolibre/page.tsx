import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { conColumnasOpcionales } from "@/lib/supabase/columnas-opcionales";
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

  const COMUNES =
    "id, fecha, cantidad, descripcion, estado, num_guia, url_orden, referencia_externa";

  const consulta = (columnas: string) =>
    supabase
      .from("sales")
      .select(columnas)
      .eq("canal", "mercado_libre")
      .gte("fecha", diasDesdeHoy(-DIAS_DESPACHO))
      .order("fecha", { ascending: false })
      .limit(3000) as unknown as PromiseLike<{
      data: VentaDespacho[] | null;
      error: { message: string } | null;
    }>;

  /* Lo que se queda Mercado Libre. Viene dentro de cada orden y se archiva al
     importar, así que aquí solo se suma. La columna es de una migración que se
     aplica a mano: si todavía no está, el bloque no se pinta. */
  type FilaCosto = { total: number; comision: number | null; costo_envio: number | null };
  const comisiones = conColumnasOpcionales<FilaCosto>(
    () =>
      supabase
        .from("sale_orders")
        .select("total, comision, costo_envio")
        .eq("canal", "mercado_libre")
        .gte("fecha", diasDesdeHoy(-DIAS_COMISION))
        .neq("estado", "cancelled")
        .limit(5000) as unknown as PromiseLike<{
        data: FilaCosto[] | null;
        error: { message: string } | null;
      }>,
    async () => ({ data: [], error: null }),
    "canales/mercadolibre costos",
  );

  const [ventasRes, salud, estado, comisionesRes] = await Promise.all([
    /* Las columnas de plazo son de una migración que se aplica a mano: mientras
       no esté, la página carga con el termómetro y sin el tablero, en vez de
       quedarse en blanco. */
    conColumnasOpcionales<VentaDespacho>(
      () => consulta(`${COMUNES}, envio_limite_despacho, envio_despachado_en`),
      () => consulta(COMUNES),
      "canales/mercadolibre",
    ),
    /* Si Mercado Libre no contesta, el resto de la página sigue en pie. */
    saludML(),
    estadoMercadolibre(),
    comisiones,
  ]);

  /* Solo las órdenes que traen comisión: mezclar las que no la tienen (las
     importadas antes de la migración) hundiría la tasa y haría creer que ML
     cobra menos de lo que cobra. */
  let ventaConDato = 0;
  let comision = 0;
  let flete = 0;
  let ordenesConDato = 0;
  for (const o of comisionesRes.data ?? []) {
    if (o.comision == null) continue;
    ventaConDato += Number(o.total || 0);
    comision += Number(o.comision);
    flete += Number(o.costo_envio || 0);
    ordenesConDato++;
  }
  const cargos = comision + flete;
  const costos =
    ordenesConDato > 0
      ? {
          venta: Math.round(ventaConDato * 100) / 100,
          comision: Math.round(comision * 100) / 100,
          flete: Math.round(flete * 100) / 100,
          /* La tasa es sobre TODO lo que se va, no solo la comisión: es lo que
             de verdad separa el precio de venta de lo que queda. */
          tasa: ventaConDato > 0 ? (cargos / ventaConDato) * 100 : 0,
          ordenes: ordenesConDato,
          dias: DIAS_COMISION,
        }
      : null;

  const ventas = (ventasRes.data ?? []) as VentaDespacho[];
  /* Si la migración no se ha aplicado, PostgREST devolvió las filas sin esas
     claves. Se distingue así en vez de mostrar "0 pendientes", que se leería
     como que todo está despachado. */
  const conPlazos = ventas.length === 0 || "envio_limite_despacho" in ventas[0];

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
      conPlazos={conPlazos}
      dias={DIAS_DESPACHO}
      ahora={ahora}
    />
  );
}
