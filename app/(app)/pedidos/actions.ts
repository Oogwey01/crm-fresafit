"use server";

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { traerTodo } from "@/lib/canales/paginacion";
import { diasDesdeHoy } from "@/lib/fecha";
import {
  COLUMNAS_PEDIDO,
  DIAS_VENTANA_PEDIDOS,
  ESTADOS_PEDIDO_TERMINALES,
} from "@/lib/pedidos/consulta";
import type { EstadoPedidoId, EtapaEmpaqueId, PedidoEnvio } from "@/lib/types";

const RUTAS = ["/pedidos", "/metricas", "/clientes"];
const revalidar = () => RUTAS.forEach((r) => revalidatePath(r));

/* El histórico de la ventana (entregados y cancelados): la página ya solo
   carga lo que da trabajo, y esto se pide UNA vez, cuando alguien cambia al
   filtro de «Todos» o «Entregados». Mismas columnas y misma ventana que la
   carga inicial, para que un pedido se vea idéntico venga de donde venga.

   Paginado con traerTodo: los entregados de 120 días pasan de mil filas, y el
   `.limit(5000)` que llevaba antes era mentira — PostgREST corta en ~1000 SIN
   error, así que el filtro de «Entregados» mostraba una ventana mutilada. El
   `id` desempata fechas repetidas de las importaciones en lote. */
export async function listarPedidosHistorico(): Promise<
  { pedidos: PedidoEnvio[] } | { error: string }
> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede ver los pedidos.");
  if ("error" in cx) return cx;

  try {
    const pedidos = await traerTodo<PedidoEnvio>((desde, hasta) =>
      cx.supabase
        .from("sales")
        .select(COLUMNAS_PEDIDO)
        .in("estado", [...ESTADOS_PEDIDO_TERMINALES])
        .gte("fecha", diasDesdeHoy(-DIAS_VENTANA_PEDIDOS))
        .order("fecha", { ascending: false })
        .order("id")
        .range(desde, hasta),
    );
    return { pedidos };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo cargar el histórico." };
  }
}

/* Cambio de estado del pedido en línea (nuevo → preparando → enviado → …).

   Va por RPC y no por UPDATE directo por una razón concreta: TODOS los pedidos
   pendientes son `origen = 'api'` —los tres canales entran solos— y la RLS de
   20260805000100 reserva la edición de esas ventas a dirección, para que nadie
   descuadre monto ni cantidad contra el canal. Un UPDATE que la RLS descarta no
   devuelve error: PostgREST contesta 204 con cero filas, así que esto respondía
   `ok` y bodega veía el toast verde mientras el pedido se quedaba donde estaba.
   `mover_estado_pedido` (20261020000000) escribe SOLO `estado` para cualquier
   interno y deja el dinero bajo llave. Ver ARQUITECTURA.md. */
export async function cambiarEstadoPedido(id: string, estado: EstadoPedidoId): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede mover pedidos.");
  if ("error" in cx) return cx;

  /* Cancelar sí es del lado del dinero —retira la venta de Métricas y devuelve
     stock—, así que sigue por el camino normal y la RLS decide. */
  if (estado === "cancelado") {
    const { data, error } = await cx.supabase
      .from("sales")
      .update({ estado })
      .eq("id", id)
      .select("id");
    if (error) return { error: error.message };
    if (!data?.length) {
      return { error: "Cancelar una venta que vino del canal es de Dirección." };
    }
    revalidar();
    return { ok: true };
  }

  const { data, error } = await cx.supabase.rpc("mover_estado_pedido", {
    p_id: id,
    p_estado: estado,
  });
  if (error) return { error: error.message };
  if (!data) return { error: "Ese pedido ya no está o está cancelado; recarga la lista." };
  revalidar();
  return { ok: true };
}

/* Guardar paquetería y número de guía (y opcionalmente marcar enviado).
   Por RPC y con el conteo de filas, por lo mismo que `cambiarEstadoPedido`. */
export async function guardarEnvio(
  id: string,
  paqueteria: string,
  numGuia: string,
): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede editar envíos.");
  if ("error" in cx) return cx;

  /* Los dos campos viajan crudos: el vaciado a NULL lo hace la RPC con el mismo
     criterio que `textoONulo` (btrim + nullif), y así el contrato de la función
     no depende de que cada caller se acuerde de limpiar. La RPC borra además la
     URL de rastreo que hubiera dado el canal: apuntaba a la guía anterior, y un
     enlace que lleva al paquete equivocado es peor que ninguno. Sin ella, el CRM
     la deriva de la paquetería (lib/pedidos/rastreo.ts). */
  const { data, error } = await cx.supabase.rpc("guardar_envio_pedido", {
    p_id: id,
    p_paqueteria: paqueteria,
    p_num_guia: numGuia,
  });
  if (error) return { error: error.message };
  if (!data) return { error: "Ese pedido ya no está; recarga la lista." };
  revalidar();
  return { ok: true };
}

/* Mover una tarjeta en el tablero de empaque (migración 20261024000000).

   La RPC hace dos cosas de un golpe: sella la etapa con la hora —que es lo que
   alimenta el "1h 11min en esta etapa"— y avanza `sales.estado` a través de
   `avanzar_estado_pedido`, que solo deja subir. De ahí que arrastrar hacia atrás
   corrija la mesa sin desandar lo que el canal ya dio por hecho.

   Mismo motivo que `cambiarEstadoPedido` para ir por RPC y no por UPDATE: la RLS
   de las ventas `origen = 'api'` —o sea, todas las pendientes— descarta el
   UPDATE en silencio y el toast saldría verde con el pedido sin moverse. */
export async function moverEtapaEmpaque(id: string, etapa: EtapaEmpaqueId): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede mover el tablero.");
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase.rpc("mover_etapa_empaque", {
    p_id: id,
    p_etapa: etapa,
  });
  if (error) return { error: error.message };
  if (!data) return { error: "Ese pedido ya no está o está cancelado; recarga la lista." };
  revalidar();
  return { ok: true };
}
