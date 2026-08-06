/* ============================================================================
   lib/tiktok/ventas.ts — Importación de ventas desde TikTok Shop
   ----------------------------------------------------------------------------
   Convierte órdenes PAGADAS en renglones de `sales` (uno por line_item; cada
   line_item de TikTok es una unidad vendida). Idempotente:
   referencia_externa = "<order_id>:<line_item_id>" con UNIQUE (canal, ref) —
   webhook, cron y botón corren juntos sin duplicar. Las canceladas retiran sus
   renglones. El estado de envío viene INLINE en la orden (no hay llamada extra
   como en Mercado Libre). Solo servidor (service role).

   Cliente por buyer_email (TikTok enmascara el PII); la sync de clientes es NO
   fatal (la venta se registra igual). Ver [[integracion-tiendanube]] para el
   patrón compartido con ML/TN.
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
import { normalizarDireccion, type DireccionEnvio } from "@/lib/canales/direccion";
import {
  conexionTiktok,
  listarOrdenesTikTok,
  obtenerOrdenTikTok,
  type ConexionTikTok,
  type OrdenTikTok,
} from "@/lib/tiktok/api";

export type ResumenVentasTikTok = {
  ordenes: number;
  insertadas: number;
  actualizadas: number; // renglones ya importados que se corrigieron (fecha, monto, envío)
  existentes: number;
  retiradas: number;
  clientes: number;
  descontadas: number; // fichas a las que la venta les bajó el inventario de TikTok
  devueltas: number; // fichas a las que una cancelación se lo regresó
  /* Fichas que viven en TikTok Y en otro canal pero de las que TikTok todavía no
     ha reportado su propio número: no hay de dónde restar sin inventar un dato.
     Se resuelven solas en la siguiente pasada de catálogo. */
  sin_dato: number;
};

/* Apagable desde Vercel sin tocar código: STOCK_TIKTOK_VENTAS=off.
   Encendido por defecto, a diferencia del hub de bodega: esto no compite con
   ningún otro escritor —el inventario de TikTok solo lo mueve TikTok— y la
   pasada nocturna reescribe el número absoluto, así que un error se corrige
   solo en menos de un día. */
const DESCUENTO_TIKTOK_ACTIVO = process.env.STOCK_TIKTOK_VENTAS !== "off";

/* Lo que devuelve mover_stock_tiktok (ver 20260908000000_stock_tiktok_ventas.sql). */
type MovimientoTikTok = {
  producto: string;
  sku: string | null;
  almacen: "stock" | "tiktok_stock" | "sin_dato";
  anterior: number | null;
  nuevo: number | null;
  movido: number;
};

/* Renglones de venta → lo que espera la RPC. */
function itemsDeStock(
  filas: { producto_id: string | null; cantidad: number }[],
): { producto_id: string; cantidad: number }[] {
  return filas
    .filter((r) => r.producto_id)
    .map((r) => ({ producto_id: r.producto_id as string, cantidad: r.cantidad }));
}

/* UNPAID no es venta todavía; CANCELLED se retira. El resto (ON_HOLD,
   AWAITING_*, IN_TRANSIT, DELIVERED, COMPLETED) son órdenes pagadas. */
function esVendible(o: OrdenTikTok): boolean {
  return o.status !== "UNPAID" && o.status !== "CANCELLED";
}
function estaCancelada(o: OrdenTikTok): boolean {
  return o.status === "CANCELLED";
}

type EstadoPedido = "nuevo" | "preparando" | "enviado" | "entregado";
function estadoDe(o: OrdenTikTok): EstadoPedido {
  switch (o.status) {
    case "DELIVERED":
    case "COMPLETED":
      return "entregado";
    case "IN_TRANSIT":
      return "enviado";
    case "AWAITING_COLLECTION":
      return "preparando";
    default: // ON_HOLD | AWAITING_SHIPMENT
      return "nuevo";
  }
}

function refLinea(orderId: string, lineItemId: string): string {
  return `${orderId}:${lineItemId}`;
}

/* Día de la venta, en hora de México. `create_time` es epoch en segundos y antes
   se convertía con toISOString(), que normaliza a UTC: toda venta hecha después
   de las ~18:00 quedaba registrada al día siguiente. Era el canal peor desfasado
   de los tres. */
function fechaDe(o: OrdenTikTok): string {
  const ms = (o.create_time ?? Math.floor(Date.now() / 1000)) * 1000;
  return diaMX(ms);
}

/* Importes de la orden como los reporta el panel de TikTok Shop. */
function totalDeOrden(orden: OrdenTikTok, clienteId: string | null): TotalOrden {
  const p = orden.payment;
  const subtotal = aMonto(p?.sub_total);
  const envio = aMonto(p?.shipping_fee);
  const impuesto = aMonto(p?.tax);
  const descuento = aMonto(p?.seller_discount) + aMonto(p?.platform_discount);
  const total = p?.total_amount != null ? aMonto(p.total_amount) : subtotal + envio + impuesto - descuento;
  return {
    canal: "tiktok_shop",
    referencia_orden: orden.id,
    numero: orden.id,
    fecha: fechaDe(orden),
    total,
    subtotal,
    envio,
    descuento,
    impuesto,
    moneda: p?.currency?.trim() || "MXN",
    estado: orden.status ?? null,
    cliente_id: clienteId,
  };
}

/* Nivel de la jerarquía de TikTok por su nombre ("State", "City", "District"…).
   Se compara en minúsculas porque el rótulo llega localizado y sin garantía de
   mayúsculas. */
function nivel(orden: OrdenTikTok, ...nombres: string[]): string | null {
  const niveles = orden.recipient_address?.district_info ?? [];
  for (const n of nombres) {
    const hit = niveles.find((d) => (d.address_level_name ?? "").toLowerCase() === n);
    if (hit?.address_name) return hit.address_name;
  }
  return null;
}

/* Dirección de entrega de la orden, traducida al formato común del CRM. */
function direccionDe(orden: OrdenTikTok): DireccionEnvio | null {
  const d = orden.recipient_address;
  if (!d) return null;
  return normalizarDireccion({
    nombre: d.name,
    telefono: d.phone_number,
    /* TikTok no separa calle y número: el detalle viene en una sola cadena. */
    calle: d.address_detail ?? d.address_line1,
    colonia: nivel(orden, "district", "neighborhood"),
    ciudad: nivel(orden, "city", "municipality"),
    estado: nivel(orden, "state", "province"),
    cp: d.postal_code,
    pais: nivel(orden, "country") ?? d.region_code,
    referencias: d.full_address,
  });
}

/* Renglones de `sales` de una orden (ya vendible). */
function filasDeOrden(
  orden: OrdenTikTok,
  productoPorSku: Map<string, string>,
  clientePorBuyer: Map<string, string>,
) {
  const fecha = fechaDe(orden);
  const estado = estadoDe(orden);
  const paqueteria = orden.shipping_provider?.trim() || null;
  const numGuia = orden.tracking_number?.trim() || null;
  const direccion = direccionDe(orden);
  const clienteId = orden.buyer_email ? (clientePorBuyer.get(orden.buyer_email) ?? null) : null;
  return (orden.line_items ?? []).map((li) => {
    const monto = Math.round((Number(li.sale_price) || 0) * 100) / 100;
    return {
      fecha,
      canal: "tiktok_shop",
      producto_id: li.sku_id ? (productoPorSku.get(li.sku_id) ?? null) : null,
      descripcion: li.product_name || null,
      cantidad: 1,
      monto,
      cliente_id: clienteId,
      estado,
      paqueteria,
      num_guia: numGuia,
      envio_direccion: direccion,
      origen: "api",
      referencia_externa: refLinea(orden.id, li.id),
      notas: `Orden TikTok #${orden.id}`,
    };
  });
}

/* Mapa sku de TikTok → id de producto del CRM. Se lee de `tiktok_publicaciones`
   y no de `products`: un mismo artículo puede tener VARIAS publicaciones en
   TikTok (una borrada y resubida, un borrador, otro título), y todas venden el
   mismo inventario. `products` solo guarda la principal, así que las ventas que
   entraban por las demás se quedaban sin producto.
   Con pocos SKUs en juego (webhook de una orden) trae SOLO esas filas; con
   muchos (sync completa) carga la tabla entera, paginada con traerTodo para
   que PostgREST no la trunque en ~1000 filas sin avisar. */
async function mapaUnidades(skuIds: string[]): Promise<Map<string, string>> {
  const admin = createAdminClient();
  const ids = [...new Set(skuIds)];
  const acotado = ids.length <= 50;
  const data = await traerTodo<{ producto_id: string; tiktok_sku_id: string }>((desde, hasta) => {
    const q = admin.from("tiktok_publicaciones").select("producto_id, tiktok_sku_id");
    return (acotado ? q.in("tiktok_sku_id", ids) : q).range(desde, hasta);
  });
  return new Map(data.map((p) => [p.tiktok_sku_id, p.producto_id]));
}

/* Crea/actualiza clientes por buyer_email (única identidad que da TikTok). */
async function sincronizarClientes(ordenes: OrdenTikTok[]): Promise<Map<string, string>> {
  const buyers = new Set<string>();
  for (const o of ordenes) if (o.buyer_email) buyers.add(o.buyer_email);

  return upsertClientesPorClave<string>(
    "tiktok_buyer_id",
    [...buyers].map((email) => ({
      tiktok_buyer_id: email,
      nombre: email,
      canal: "tiktok_shop",
    })),
  );
}

/* Inserta renglones nuevos, refresca estado y retira los de canceladas. */
/* `selloEspejo` es el momento de la última pasada de CATÁLOGO (no la de ventas):
   ver la nota de `descontarVentas`. En milisegundos, o null si nunca corrió. */
async function aplicarOrdenes(
  ordenes: OrdenTikTok[],
  selloEspejo: number | null,
): Promise<ResumenVentasTikTok> {
  const admin = createAdminClient();
  const vendibles = ordenes.filter(esVendible);

  /* Independientes entre sí → en paralelo (mismo patrón que Tienda Nube). La
     sync de clientes sigue siendo NO fatal: la venta se registra igual. */
  const [unidades, clientes] = await Promise.all([
    mapaUnidades(
      vendibles
        .flatMap((o) => (o.line_items ?? []).map((li) => li.sku_id))
        .filter((s): s is string => !!s),
    ),
    sincronizarClientes(vendibles).catch((e): Map<string, string> => {
      console.error("[tiktok] sync de clientes:", e);
      return new Map();
    }),
  ]);

  const filas = vendibles.flatMap((o) => filasDeOrden(o, unidades, clientes));
  let insertadas = 0;
  let actualizadas = 0;
  let descontadas = 0;
  let devueltas = 0;
  let sinDato = 0;
  if (filas.length > 0) {
    const { data, error } = await admin
      .from("sales")
      .upsert(filas, { onConflict: "canal,referencia_externa", ignoreDuplicates: true })
      .select("id, producto_id, cantidad, referencia_externa");
    if (error) throw new Error(error.message);
    insertadas = data?.length ?? 0;

    /* Con `ignoreDuplicates`, `data` son SOLO las ventas nuevas: un reintento de
       webhook o el traslape del cron no vuelven a descontar. */
    const movidas = await descontarVentas(admin, data ?? [], vendibles, selloEspejo);
    descontadas = movidas.movidas;
    sinDato = movidas.sinDato;

    // Backfill de cliente_id en ventas ya importadas sin cliente.
    const porCliente = new Map<string, string[]>();
    for (const f of filas) {
      if (!f.cliente_id) continue;
      (porCliente.get(f.cliente_id) ?? porCliente.set(f.cliente_id, []).get(f.cliente_id)!).push(
        f.referencia_externa,
      );
    }
    for (const [clienteId, refs] of porCliente) {
      for (let i = 0; i < refs.length; i += 200) {
        await admin
          .from("sales")
          .update({ cliente_id: clienteId })
          .eq("canal", "tiktok_shop")
          .is("cliente_id", null)
          .in("referencia_externa", refs.slice(i, i + 200));
      }
    }

    /* Refrescar los renglones ya importados: TikTok es la fuente de verdad del
       estado y de la guía. Además corrige la FECHA, que aquí importa más que en
       los otros canales: hasta ahora se calculaba en UTC, así que buena parte
       del histórico está corrido un día. */
    actualizadas = await refrescarRenglones(
      "tiktok_shop",
      filas.map((f) => ({
        referencia_externa: f.referencia_externa,
        fecha: f.fecha,
        monto: f.monto,
        cantidad: f.cantidad,
        estado: f.estado,
        paqueteria: f.paqueteria,
        num_guia: f.num_guia,
        envio_direccion: f.envio_direccion,
      })),
    );
  }

  /* Totales por orden: de aquí sale el KPI de ventas de Métricas. */
  await guardarTotalesOrden(
    vendibles.map((o) =>
      totalDeOrden(o, o.buyer_email ? (clientes.get(o.buyer_email) ?? null) : null),
    ),
  );

  const refsCanceladas = ordenes
    .filter(estaCancelada)
    .flatMap((o) => (o.line_items ?? []).map((li) => refLinea(o.id, li.id)));
  let retiradas = 0;
  if (refsCanceladas.length > 0) {
    const borrados: { producto_id: string | null; cantidad: number }[] = [];
    for (let i = 0; i < refsCanceladas.length; i += 200) {
      const { data, error } = await admin
        .from("sales")
        .delete()
        .eq("canal", "tiktok_shop")
        .in("referencia_externa", refsCanceladas.slice(i, i + 200))
        .select("id, producto_id, cantidad");
      if (error) throw new Error(error.message);
      retiradas += data?.length ?? 0;
      for (const r of data ?? []) {
        borrados.push({ producto_id: r.producto_id as string | null, cantidad: r.cantidad as number });
      }
    }

    /* Solo se devuelve lo que EXISTÍA y se acaba de borrar, así que un segundo
       aviso de la misma cancelación no encuentra nada y no devuelve dos veces.
       Se llama una sola vez con todo lo acumulado —no una por tanda— para que el
       historial lo muestre como una operación y no como N sueltas.

       Aquí NO se aplica el filtro del espejo que sí lleva el descuento: una
       cancelación puede ser posterior a la última pasada de catálogo, y devolver
       de más se corrige en la siguiente. */
    if (DESCUENTO_TIKTOK_ACTIVO && borrados.length > 0) {
      try {
        const items = itemsDeStock(borrados);
        if (items.length > 0) {
          const { data: movs, error: errDev } = await admin.rpc("devolver_stock_tiktok", {
            items,
            p_origen: "cancelacion_tiktok",
          });
          if (errDev) throw new Error(errDev.message);
          for (const m of (movs ?? []) as MovimientoTikTok[]) {
            if (m.almacen === "sin_dato") sinDato++;
            else devueltas++;
          }
        }
      } catch (e) {
        console.error("[tiktok] devolución de stock por cancelación:", e);
      }
    }
  }

  if (sinDato > 0) {
    console.warn(
      `[tiktok] ${sinDato} ficha(s) sin número propio de TikTok todavía: su venta no movió nada. Se resuelven con la próxima sync de catálogo.`,
    );
  }

  return {
    ordenes: ordenes.length,
    insertadas,
    actualizadas,
    existentes: filas.length - insertadas,
    retiradas,
    clientes: clientes.size,
    descontadas,
    devueltas,
    sin_dato: sinDato,
  };
}

/* ----------------------------------------------------------------------------
   Descuento por venta
   ----------------------------------------------------------------------------
   Una venta de TikTok baja el inventario de TikTok y NUNCA el de bodega; de
   repartirlo entre `stock` y `tiktok_stock` según la ficha se encarga la RPC
   (ver supabase/migrations/20260908000000_stock_tiktok_ventas.sql).

   Va sin el candado del hub de ventas (`HUB_VENTAS_ACTIVO` / la lista blanca del
   piloto) a propósito: ese candado existe para que el CRM no gobierne el stock
   de BODEGA mientras Tienda Nube también lo gobierna, y para frenar las
   escrituras HACIA los canales. Aquí no ocurre ninguna de las dos cosas —no se
   toca bodega y no se llama a `propagarStock`: TikTok ya descontó lo suyo al
   vender—.

   EL FILTRO DEL ESPEJO. El cron de TikTok corre catálogo y DESPUÉS ventas en la
   misma petición. El catálogo escribe el número absoluto que reporta TikTok, que
   YA trae las ventas de la noche descontadas; si acto seguido se restaran esas
   mismas ventas (porque su webhook se perdió y llegan como nuevas), se restarían
   dos veces, todos los días. Por eso solo se descuentan las órdenes que TikTok
   creó DESPUÉS de la última pasada de catálogo: si el espejo es más reciente que
   la venta, el número local ya la incluye. Saltarse el descuento nunca deja el
   dato peor de como está hoy —«tan fresco como la última pasada»—, mientras que
   restar de más inventa unidades que no existen. */
async function descontarVentas(
  admin: ReturnType<typeof createAdminClient>,
  nuevas: { producto_id: string | null; cantidad: number; referencia_externa: string }[],
  vendibles: OrdenTikTok[],
  selloEspejo: number | null,
): Promise<{ movidas: number; sinDato: number }> {
  if (!DESCUENTO_TIKTOK_ACTIVO || nuevas.length === 0) return { movidas: 0, sinDato: 0 };

  let candidatas = nuevas;
  if (selloEspejo !== null) {
    const posteriores = new Set<string>();
    for (const o of vendibles) {
      if ((o.create_time ?? 0) * 1000 <= selloEspejo) continue;
      for (const li of o.line_items ?? []) posteriores.add(refLinea(o.id, li.id));
    }
    candidatas = nuevas.filter((r) => posteriores.has(r.referencia_externa));
  }

  const items = itemsDeStock(candidatas);
  if (items.length === 0) return { movidas: 0, sinDato: 0 };

  /* Diagnóstico, no flujo de negocio: si el stock falla, la venta ya quedó
     registrada y eso es lo que no se puede perder (mismo criterio que TN y ML). */
  try {
    const { data: movs, error } = await admin.rpc("descontar_stock_tiktok", {
      items,
      p_origen: "venta_tiktok",
    });
    if (error) throw new Error(error.message);
    let movidas = 0;
    let sinDato = 0;
    for (const m of (movs ?? []) as MovimientoTikTok[]) {
      if (m.almacen === "sin_dato") sinDato++;
      else movidas++;
    }
    return { movidas, sinDato };
  } catch (e) {
    console.error("[tiktok] descuento de stock por venta:", e);
    return { movidas: 0, sinDato: 0 };
  }
}

/* Importación por ventana de fechas (cron / botón). */
export async function importarVentasTikTok(
  cxParam?: ConexionTikTok,
  opts?: OpcionesImportacion,
): Promise<ResumenVentasTikTok> {
  const cx = cxParam ?? (await conexionTiktok());
  if (!cx) throw new Error("TikTok Shop no está conectado.");

  const datos = await leerDatosIntegracion("tiktok");
  const ultimaSync =
    !opts?.completo && typeof datos.ventas_ultima_sync === "string" ? datos.ventas_ultima_sync : null;

  const desdeUnix = Math.floor(
    ventanaDesde(ultimaSync, opts).getTime() / 1000,
  );

  const ordenes = await listarOrdenesTikTok(cx, desdeUnix);
  /* `ultima_sync` es la pasada de CATÁLOGO, no la de ventas: es el momento en
     que el CRM copió por última vez los números de TikTok. Ver `descontarVentas`. */
  const resumen = await aplicarOrdenes(ordenes, selloEspejoDe(datos));

  await mezclarDatosIntegracion("tiktok", { ventas_ultima_sync: new Date().toISOString() }, datos);

  return resumen;
}

/* Cuándo copió el CRM por última vez los números que reporta TikTok. */
function selloEspejoDe(datos: Record<string, unknown>): number | null {
  const iso = typeof datos.ultima_sync === "string" ? datos.ultima_sync : null;
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/* Procesa UNA orden avisada por webhook. */
export async function procesarOrdenTikTok(orderId: string): Promise<void> {
  const cx = await conexionTiktok();
  if (!cx) return;
  const orden = await obtenerOrdenTikTok(cx, orderId);
  if (!orden) return;
  /* Una consulta de más en un webhook es irrelevante, y es la que evita que una
     venta ya reflejada por la pasada de catálogo se descuente dos veces. */
  await aplicarOrdenes([orden], selloEspejoDe(await leerDatosIntegracion("tiktok")));
}
