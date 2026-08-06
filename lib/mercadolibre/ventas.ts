/* ============================================================================
   lib/mercadolibre/ventas.ts — Importación de ventas desde Mercado Libre
   ----------------------------------------------------------------------------
   Convierte órdenes PAGADAS en renglones de `sales` (un renglón por producto
   vendido). Idempotente: referencia_externa = "<order_id>:<item_id>:<var_id>"
   con UNIQUE (canal, referencia_externa) — webhook, cron y botón pueden correr
   juntos sin duplicar. Las órdenes canceladas retiran sus renglones.
   Solo servidor (service role).

   Diferencia con Tienda Nube: ML restringe el PII del comprador. Se identifica
   al cliente por buyer.id (columna mercadolibre_buyer_id), no por correo, y la
   sincronización de clientes es NO fatal: si falla o falta la columna, la venta
   se registra igual (con cliente_id nulo) y un full-sync posterior la liga.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/canales/paginacion";
import { upsertClientesPorClave } from "@/lib/canales/clientes";
import { leerDatosIntegracion, mezclarDatosIntegracion } from "@/lib/canales/integraciones";
import {
  aMonto,
  guardarTotalesOrden,
  refrescarRenglones,
  ventanaDesde,
  type OpcionesImportacion,
  type TotalOrden,
} from "@/lib/canales/ventas-cuadre";
import { diaMX } from "@/lib/fecha";
import type { EstadoPedidoId } from "@/lib/types";
import { normalizarDireccion, type DireccionEnvio } from "@/lib/canales/direccion";
import { urlOrdenML } from "@/lib/pedidos/rastreo";
import {
  conexionMercadolibre,
  costoEnvioVendedorML,
  listarOrdenesML,
  obtenerEnvioML,
  obtenerOrdenML,
  type ConexionML,
  type EnvioML,
  type OrdenML,
} from "@/lib/mercadolibre/api";
import { HUB_VENTAS_ACTIVO, productosDelPiloto } from "@/lib/inventario/hub-config";
import { propagarStock, type FilaVinculada } from "@/lib/inventario/stock-hub";

export type ResumenVentasML = {
  ordenes: number;
  insertadas: number;
  actualizadas: number; // renglones ya importados que se corrigieron (fecha, monto, envío)
  existentes: number;
  retiradas: number; // renglones eliminados por órdenes canceladas
  clientes: number; // clientes creados o actualizados desde las órdenes
};

function esVendible(o: OrdenML): boolean {
  return o.status === "paid";
}

function estaCancelada(o: OrdenML): boolean {
  return o.status === "cancelled" || o.status === "invalid";
}

/* Clave de la unidad vendida = misma llave con la que el catálogo mapea a
   `products` (meli_item_id + meli_variation_id). */
function claveUnidad(itemId: string, variationId: number | null): string {
  return `${itemId}:${variationId ?? ""}`;
}

/* referencia_externa estable por renglón de la orden. */
function refLinea(orderId: number, itemId: string, variationId: number | null): string {
  return `${orderId}:${itemId}:${variationId ?? ""}`;
}

function nombreComprador(o: OrdenML): string | null {
  const b = o.buyer;
  if (!b) return null;
  const nombre = [b.first_name, b.last_name]
    .map((x) => x?.trim())
    .filter(Boolean)
    .join(" ");
  return nombre || b.nickname?.trim() || null;
}

/* El subconjunto que escriben los importadores: "cancelado" nunca se guarda —
   una orden cancelada retira sus renglones en vez de marcarse. */
type EstadoPedido = Exclude<EstadoPedidoId, "cancelado">;
type InfoEnvio = {
  estado: EstadoPedido;
  paqueteria: string | null;
  num_guia: string | null;
  /* Id del shipment: con él se pide la etiqueta PDF a la API para imprimirla
     desde /pedidos. Solo se guarda en los envíos aún en curso. */
  envio_id: string | null;
  direccion: DireccionEnvio | null;
  /* Los dos lados de la métrica que decide nuestra exposición: hasta cuándo
     teníamos para entregarle el paquete al transportista, y cuándo salió de
     verdad. Ver lib/mercadolibre/desempeno.ts. */
  limite_despacho: string | null;
  despachado_en: string | null;
  /* Lo que nos cuesta a NOSOTROS ese envío (no lo que pagó el comprador). */
  costo_envio: number | null;
};

const SIN_ENVIO: InfoEnvio = {
  estado: "nuevo",
  paqueteria: null,
  num_guia: null,
  envio_id: null,
  direccion: null,
  limite_despacho: null,
  despachado_en: null,
  costo_envio: null,
};

/* status de un envío de Mercado Libre → estado de pedido del CRM (mismo espíritu
   que el shipping_status de Tienda Nube). */
function estadoDeEnvio(env: EnvioML | null): EstadoPedido {
  switch (env?.status) {
    case "delivered":
      return "entregado";
    case "shipped":
    case "not_delivered": // en tránsito / con incidencia de entrega
      return "enviado";
    case "ready_to_ship": // empacado, esperando recolección
      return "preparando";
    default: // pending / handling / to_be_agreed / cancelled / sin envío
      return "nuevo";
  }
}

/* Hasta cuándo hay para entregarle el paquete al transportista.

   Mercado Libre documenta un `estimated_handling_limit` con la fecha ya hecha,
   pero esta cuenta no lo recibe: llega ausente en los dos formatos del recurso
   (verificado con scripts/probar-envios-ml.mjs). Lo que sí manda son las HORAS
   de manejo concedidas y el instante en que el envío entró a preparación, que
   es de donde sale ese mismo plazo.

   Se reconstruye solo cuando llegan los dos datos: preferimos no tener plazo a
   inventar uno con un default, porque un plazo inventado haría que el tablero
   marcara como atrasados pedidos que no lo están. */
function limiteDespacho(env: EnvioML | null): string | null {
  const inicio = env?.status_history?.date_handling;
  const horas = env?.shipping_option?.estimated_delivery_time?.handling;
  if (!inicio || typeof horas !== "number" || horas <= 0) return null;
  const arranque = Date.parse(inicio);
  if (Number.isNaN(arranque)) return null;
  return new Date(arranque + horas * 3_600_000).toISOString();
}

const CONCURRENCIA = 8;

/* Ejecuta `tarea` sobre la lista en tandas, para no abrir cien peticiones a la
   vez contra Mercado Libre. */
async function enTandas<T>(lista: T[], tarea: (x: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < lista.length; i += CONCURRENCIA) {
    await Promise.all(lista.slice(i, i + CONCURRENCIA).map(tarea));
  }
}

/* Resuelve el estado de envío de un lote de órdenes.

   Las que los `tags` marcan como entregadas se saltan el detalle del envío
   (ahorra llamadas en el histórico) pero SÍ piden su costo: el gasto de flete
   cuenta igual aunque el paquete ya haya llegado, y sin ellas el costo del canal
   saldría corto justo en las ventas más viejas.

   Nunca lanza: sin dato, el pedido queda "nuevo" y el costo en null. */
async function infoEnvioDeOrdenes(cx: ConexionML, ordenes: OrdenML[]): Promise<Map<number, InfoEnvio>> {
  const info = new Map<number, InfoEnvio>();
  const porConsultar: OrdenML[] = [];
  const soloCosto: OrdenML[] = [];
  for (const o of ordenes) {
    if (o.tags?.includes("delivered")) {
      info.set(o.id, { ...SIN_ENVIO, estado: "entregado" });
      if (o.shipping?.id) soloCosto.push(o);
    } else if (o.shipping?.id) {
      porConsultar.push(o);
    } else {
      info.set(o.id, SIN_ENVIO);
    }
  }

  /* Entregadas: una sola llamada, la del costo. */
  await enTandas(soloCosto, async (o) => {
    const costo = await costoEnvioVendedorML(cx, o.shipping!.id!);
    const previo = info.get(o.id) ?? SIN_ENVIO;
    info.set(o.id, { ...previo, costo_envio: costo });
  });

  await enTandas(porConsultar, async (o) => {
    const [env, costo] = await Promise.all([
      obtenerEnvioML(cx, o.shipping!.id!),
      costoEnvioVendedorML(cx, o.shipping!.id!),
    ]);
    {
        const d = env?.receiver_address;
        info.set(o.id, {
          estado: estadoDeEnvio(env),
          paqueteria: env?.tracking_method?.trim() || null,
          num_guia: env?.tracking_number?.trim() || null,
          envio_id: String(o.shipping!.id!),
          costo_envio: costo,
          limite_despacho:
            env?.shipping_option?.estimated_handling_limit?.date ?? limiteDespacho(env),
          despachado_en: env?.status_history?.date_shipped ?? null,
          /* Las órdenes ya marcadas como entregadas por `tags` no pasan por aquí
             y se quedan sin dirección: ya no hay nada que empacar, y ahorrarse
             esas llamadas es lo que hace viable importar el histórico. */
          direccion: d
            ? normalizarDireccion({
                nombre: d.receiver_name,
                telefono: d.receiver_phone,
                calle: d.street_name,
                numero: d.street_number,
                colonia: d.neighborhood?.name,
                ciudad: d.city?.name,
                estado: d.state?.name,
                cp: d.zip_code,
                pais: d.country?.name,
                referencias: d.comment,
              })
            : null,
      });
    }
  });
  return info;
}

/* Día de la venta, en hora de México. Mercado Libre devuelve el instante con su
   propio offset, así que cortarlo con slice(0,10) dejaba las ventas de la noche
   en el día siguiente. Armando lo describió al revés pero con el dato correcto:
   ML corta el día "a las 11 pm Hermosillo", que es medianoche de Ciudad de
   México — el mismo huso que usa el resto del CRM. */
function fechaDe(orden: OrdenML): string {
  return diaMX(orden.date_closed ?? orden.date_created);
}

/* Importes de la orden como los reporta el panel de ML. `total_amount` es solo
   producto; el envío y el cupón viven aparte, y son justo lo que le faltaba al
   CRM para cuadrar. */
function totalDeOrden(
  orden: OrdenML,
  clienteId: string | null,
  costoEnvio: number | null,
): TotalOrden {
  const subtotal = aMonto(orden.total_amount);
  const envio = (orden.payments ?? []).reduce((a, p) => a + aMonto(p.shipping_cost), 0);
  const impuesto =
    aMonto(orden.taxes?.amount) ||
    (orden.payments ?? []).reduce((a, p) => a + aMonto(p.taxes_amount), 0);
  const descuento = aMonto(orden.coupon?.amount);
  /* `paid_amount` ya viene neto de todo; si falta, se reconstruye. */
  const total = orden.paid_amount != null ? aMonto(orden.paid_amount) : subtotal + envio - descuento;

  /* Lo que se queda Mercado Libre. Se suma por línea (`sale_fee`) y, si alguna
     no lo trae, se cae al total de la orden que reportan los pagos. Cuando no
     hay ni uno ni otro queda null: es distinto de "no cobró comisión". */
  const porLinea = (orden.order_items ?? []).reduce((a, l) => a + aMonto(l.sale_fee), 0);
  const porPagos = (orden.payments ?? []).reduce((a, p) => a + aMonto(p.marketplace_fee), 0);
  const comision = porLinea || porPagos || null;

  return {
    canal: "mercado_libre",
    referencia_orden: String(orden.id),
    numero: String(orden.id),
    fecha: fechaDe(orden),
    total,
    subtotal,
    envio,
    descuento,
    impuesto,
    moneda: orden.currency_id?.trim() || "MXN",
    estado: orden.status ?? null,
    cliente_id: clienteId,
    comision,
    costo_envio: costoEnvio,
  };
}

/* Renglones de `sales` de una orden (la orden ya debe ser vendible). */
function filasDeOrden(
  orden: OrdenML,
  productoPorUnidad: Map<string, string>,
  clientePorBuyer: Map<number, string>,
  infoEnvio: Map<number, InfoEnvio>,
) {
  const fecha = fechaDe(orden);
  const cliente = nombreComprador(orden);
  const clienteId = orden.buyer ? (clientePorBuyer.get(orden.buyer.id) ?? null) : null;
  const envio = infoEnvio.get(orden.id) ?? SIN_ENVIO;
  return (orden.order_items ?? []).map((linea) => {
    const cantidad = Math.max(1, Math.trunc(Number(linea.quantity) || 1));
    const unitario = Number(linea.unit_price) || 0;
    const variationId = linea.item.variation_id ?? null;
    return {
      fecha,
      canal: "mercado_libre",
      producto_id: productoPorUnidad.get(claveUnidad(linea.item.id, variationId)) ?? null,
      descripcion: linea.item.title || null,
      cantidad,
      monto: Math.round(unitario * cantidad * 100) / 100,
      cliente_id: clienteId,
      estado: envio.estado,
      paqueteria: envio.paqueteria,
      num_guia: envio.num_guia,
      envio_id: envio.envio_id,
      /* El detalle en el panel de ML se abre por el carrito, no por la orden. */
      url_orden: urlOrdenML(orden.id, orden.pack_id),
      envio_direccion: envio.direccion,
      envio_limite_despacho: envio.limite_despacho,
      envio_despachado_en: envio.despachado_en,
      origen: "api",
      referencia_externa: refLinea(orden.id, linea.item.id, variationId),
      notas: `Orden ML #${orden.id}${cliente ? ` — ${cliente}` : ""}`,
    };
  });
}

/* Mapa unidad de Mercado Libre → id de producto del CRM.

   Se lee de `meli_publicaciones` y no de `products` porque una misma ficha puede
   tener VARIAS publicaciones sobre el mismo inventario: cuando ML suma un
   artículo a su catálogo crea una publicación gemela, y la venta puede entrar
   por cualquiera de las dos. `products` solo conoce la principal.

   Con pocos ítems en juego (webhook de una orden) trae SOLO sus publicaciones;
   con muchos (sync completa) carga la tabla entera, paginada con traerTodo. */
async function mapaUnidades(itemIds: string[]): Promise<Map<string, string>> {
  const admin = createAdminClient();
  const ids = [...new Set(itemIds)];
  const acotado = ids.length <= 50;
  const data = await traerTodo<{
    meli_item_id: string;
    meli_variation_id: number | null;
    producto_id: string;
  }>((desde, hasta) => {
    const q = admin.from("meli_publicaciones").select("meli_item_id, meli_variation_id, producto_id");
    return (acotado ? q.in("meli_item_id", ids) : q).range(desde, hasta);
  });
  const m = new Map<string, string>();
  for (const p of data) {
    m.set(
      claveUnidad(p.meli_item_id as string, (p.meli_variation_id as number | null) ?? null),
      p.producto_id as string,
    );
  }
  return m;
}

/* Crea/actualiza los clientes de las órdenes y devuelve buyer_id → id de
   cliente del CRM. El correo NO se guarda a propósito: ML lo anonimiza y
   escribirlo podría chocar con el índice único de `correo` (clientes de TN).
   El comprador se identifica solo por su buyer_id. */
async function sincronizarClientes(ordenes: OrdenML[]): Promise<Map<number, string>> {
  /* Un cliente por buyer; se queda con el nombre de su orden más reciente
     (las órdenes llegan de la más nueva a la más vieja). */
  const porBuyer = new Map<number, string>();
  for (const o of ordenes) {
    const b = o.buyer;
    if (!b?.id || porBuyer.has(b.id)) continue;
    porBuyer.set(b.id, nombreComprador(o) || `ML ${b.id}`);
  }

  return upsertClientesPorClave<number>(
    "mercadolibre_buyer_id",
    [...porBuyer.entries()].map(([buyerId, nombre]) => ({
      mercadolibre_buyer_id: buyerId,
      nombre,
      canal: "mercado_libre",
    })),
  );
}

/* Inserta los renglones nuevos (ignora los ya importados) y retira los de
   órdenes canceladas. Núcleo compartido por el cron y el webhook. */
async function aplicarOrdenes(cx: ConexionML, ordenes: OrdenML[]): Promise<ResumenVentasML> {
  const admin = createAdminClient();
  const vendibles = ordenes.filter(esVendible);

  /* Los tres preparativos solo dependen de `vendibles`, así que corren en
     paralelo (mismo patrón que Tienda Nube). La sync de clientes NUNCA tira la
     importación: registrar la venta es lo prioritario (y la columna
     mercadolibre_buyer_id podría no estar aún). */
  const [unidades, clientes, infoEnvio] = await Promise.all([
    mapaUnidades(vendibles.flatMap((o) => (o.order_items ?? []).map((l) => l.item.id))),
    sincronizarClientes(vendibles).catch((e): Map<number, string> => {
      console.error("[mercadolibre] sync de clientes:", e);
      return new Map();
    }),
    infoEnvioDeOrdenes(cx, vendibles),
  ]);
  const filas = vendibles.flatMap((o) => filasDeOrden(o, unidades, clientes, infoEnvio));
  let insertadas = 0;
  let actualizadas = 0;
  if (filas.length > 0) {
    const { data, error } = await admin
      .from("sales")
      .upsert(filas, { onConflict: "canal,referencia_externa", ignoreDuplicates: true })
      .select("id, producto_id, cantidad");
    if (error) throw new Error(error.message);
    insertadas = data?.length ?? 0;

    // Hub padre-hijo (solo con el flag activo): la venta de ML descuenta el stock
    // del CRM y se empuja a los demás canales. `ignoreDuplicates` hace que `data`
    // sean solo las ventas NUEVAS, así reintentos de webhook/cron no re-descuentan.
    if (HUB_VENTAS_ACTIVO) {
      // Durante el piloto, solo los productos de la lista blanca cambian de
      // modelo; el resto del catálogo sigue gobernado por Tienda Nube.
      const aDescontar = await productosDelPiloto(
        (data ?? [])
          .filter((r) => r.producto_id)
          .map((r) => ({ producto_id: r.producto_id as string, cantidad: r.cantidad as number })),
      );
      if (aDescontar.length > 0) {
        try {
          const { data: afectados, error: errDesc } = await admin.rpc("descontar_stock_ventas", {
            items: aDescontar,
            p_origen: "venta_ml",
          });
          if (errDesc) throw new Error(errDesc.message);
          /* El RPC devuelve `descontado`: las unidades que se restaron. Van al
             hub como `delta` negativo para que cada canal reciba el MOVIMIENTO
             ("resta 2") aplicado sobre lo que realmente tenga, y no un total
             calculado aquí que podría estar viejo. */
          const filasHub = ((afectados ?? []) as (FilaVinculada & { descontado?: number })[]).map(
            (f) => ({ ...f, delta: f.descontado ? -f.descontado : null }),
          );
          if (filasHub.length > 0) {
            // origen "mercadolibre" = no reenviar a ML (ya se descontó allá); sí a TN.
            (await propagarStock("mercadolibre", filasHub, "venta_ml")).forEach((e) =>
              console.error("[stock-hub] venta ML→TN:", e),
            );
          }
        } catch (e) {
          console.error("[mercadolibre] descuento de stock por venta:", e);
        }
      }
    }

    /* Ventas ya importadas antes de que existiera el cliente: se les liga el
       cliente ahora (el upsert de arriba las ignora por duplicadas). Solo toca
       las que no tienen cliente: nunca pisa una asignación manual. */
    const porCliente = new Map<string, string[]>();
    for (const f of filas) {
      if (!f.cliente_id) continue;
      const lista = porCliente.get(f.cliente_id) ?? [];
      lista.push(f.referencia_externa);
      porCliente.set(f.cliente_id, lista);
    }
    for (const [clienteId, refs] of porCliente) {
      await admin
        .from("sales")
        .update({ cliente_id: clienteId })
        .eq("canal", "mercado_libre")
        .is("cliente_id", null)
        .in("referencia_externa", refs);
    }

    /* Refrescar los renglones que YA estaban importados. Mercado Libre es la
       fuente de verdad del fulfillment, así que éste es el paso que hace avanzar
       un pedido de nuevo→preparando→enviado→entregado (el upsert de arriba
       ignora las filas existentes). Ahora además corrige la FECHA, que es como
       se repara el histórico importado con el día sin convertir a México.
       Va por RPC, en un solo viaje por tanda en vez de un UPDATE por estado. */
    actualizadas = await refrescarRenglones(
      "mercado_libre",
      filas.map((f) => ({
        referencia_externa: f.referencia_externa,
        fecha: f.fecha,
        monto: f.monto,
        cantidad: f.cantidad,
        estado: f.estado,
        paqueteria: f.paqueteria,
        num_guia: f.num_guia,
        /* El id del envío tiene que viajar por el REFRESCO: los pedidos
           pendientes de hoy ya están importados y son justo los que necesitan
           su etiqueta. */
        envio_id: f.envio_id,
        url_orden: f.url_orden,
        envio_direccion: f.envio_direccion,
        /* Sin esto, la hora real de salida —que aparece horas después de que la
           venta se importó— nunca alcanzaría al renglón ya existente. */
        envio_limite_despacho: f.envio_limite_despacho,
        envio_despachado_en: f.envio_despachado_en,
      })),
    );
  }

  /* Totales por orden: `sales.monto` solo suma producto y el panel de ML incluye
     el envío. De aquí sale el KPI de ventas de Métricas. */
  await guardarTotalesOrden(
    vendibles.map((o) =>
      totalDeOrden(
        o,
        o.buyer ? (clientes.get(o.buyer.id) ?? null) : null,
        infoEnvio.get(o.id)?.costo_envio ?? null,
      ),
    ),
  );

  // Órdenes canceladas/inválidas: retirar sus renglones si se importaron.
  const refsCanceladas = ordenes
    .filter(estaCancelada)
    .flatMap((o) => (o.order_items ?? []).map((l) => refLinea(o.id, l.item.id, l.item.variation_id ?? null)));
  let retiradas = 0;
  if (refsCanceladas.length > 0) {
    const { data, error } = await admin
      .from("sales")
      .delete()
      .eq("canal", "mercado_libre")
      .in("referencia_externa", refsCanceladas)
      .select("id, producto_id, cantidad");
    if (error) throw new Error(error.message);
    retiradas = data?.length ?? 0;

    /* Devolver el stock de lo cancelado (simétrico al descuento por venta):
       cancelar suma la unidad de vuelta. `data` son solo los renglones que
       EXISTÍAN y se acaban de borrar, así una segunda notificación de la misma
       cancelación no devuelve dos veces.

       Mercado Libre ya restituyó lo suyo al cancelar; por eso el origen es
       "mercadolibre" y el hub reenvía el +N solo a los demás canales, no a él. */
    if (HUB_VENTAS_ACTIVO) {
      const aDevolver = await productosDelPiloto(
        (data ?? [])
          .filter((r) => r.producto_id)
          .map((r) => ({ producto_id: r.producto_id as string, cantidad: r.cantidad as number })),
      );
      if (aDevolver.length > 0) {
        try {
          const { data: afectados, error: errDev } = await admin.rpc("devolver_stock_ventas", {
            items: aDevolver,
            p_origen: "cancelacion_ml",
          });
          if (errDev) throw new Error(errDev.message);
          const filasHub = ((afectados ?? []) as (FilaVinculada & { devuelto?: number })[]).map(
            (f) => ({ ...f, delta: f.devuelto ? f.devuelto : null }),
          );
          if (filasHub.length > 0) {
            // origen "mercadolibre" = no reenviar a ML (ya restituyó); sí a TN.
            (await propagarStock("mercadolibre", filasHub, "cancelacion_ml")).forEach((e) =>
              console.error("[stock-hub] cancelación ML→TN:", e),
            );
          }
        } catch (e) {
          console.error("[mercadolibre] devolución de stock por cancelación:", e);
        }
      }
    }
  }

  return {
    ordenes: ordenes.length,
    insertadas,
    actualizadas,
    existentes: filas.length - insertadas,
    retiradas,
    clientes: clientes.size,
  };
}

/* Importación por ventana de fechas (cron diario y red de seguridad del sync).
   `completo` rescanea los 90 días aunque ya haya habido syncs: sirve para
   rellenar datos nuevos (p. ej. ligar clientes a ventas ya importadas). */
export async function importarVentasML(
  cxParam?: ConexionML,
  opts?: OpcionesImportacion,
): Promise<ResumenVentasML> {
  const cx = cxParam ?? (await conexionMercadolibre());
  if (!cx) throw new Error("Mercado Libre no está conectado.");

  const datos = await leerDatosIntegracion("mercadolibre");
  const ultimaSync =
    !opts?.completo && typeof datos.ventas_ultima_sync === "string" ? datos.ventas_ultima_sync : null;

  const desde = ventanaDesde(ultimaSync, opts);

  const ordenes = await listarOrdenesML(cx, desde.toISOString());
  const resumen = await aplicarOrdenes(cx, ordenes);

  await mezclarDatosIntegracion("mercadolibre", { ventas_ultima_sync: new Date().toISOString() }, datos);

  return resumen;
}

/* Procesa UNA orden avisada por webhook (tópico orders_v2). */
export async function procesarOrdenML(orderId: number | string): Promise<void> {
  const cx = await conexionMercadolibre();
  if (!cx) return;
  const orden = await obtenerOrdenML(cx, orderId);
  if (!orden) return;
  await aplicarOrdenes(cx, [orden]);
}
