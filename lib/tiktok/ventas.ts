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
import { leerDatosIntegracion, mezclarDatosIntegracion } from "@/lib/canales/integraciones";
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
  existentes: number;
  retiradas: number;
  clientes: number;
};

const DIAS_PRIMERA_VEZ = 90;
const DIAS_TRASLAPE = 7;

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

function fechaDe(o: OrdenTikTok): string {
  const ms = (o.create_time ?? Math.floor(Date.now() / 1000)) * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/* Renglones de `sales` de una orden (ya vendible). */
function filasDeOrden(
  orden: OrdenTikTok,
  productoPorSku: Map<string, string>,
  clientePorBuyer: Map<string, string>,
) {
  const fecha = fechaDe(orden);
  const estado = estadoDe(orden);
  const paqueteria = null;
  const numGuia = orden.tracking_number?.trim() || null;
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
  const admin = createAdminClient();
  const buyers = new Set<string>();
  for (const o of ordenes) if (o.buyer_email) buyers.add(o.buyer_email);
  if (buyers.size === 0) return new Map();

  const filas = [...buyers].map((email) => ({
    tiktok_buyer_id: email,
    nombre: email,
    canal: "tiktok_shop",
  }));
  const { error } = await admin.from("customers").upsert(filas, { onConflict: "tiktok_buyer_id" });
  if (error) throw new Error(error.message);

  const { data, error: errSel } = await admin
    .from("customers")
    .select("id, tiktok_buyer_id")
    .in("tiktok_buyer_id", [...buyers]);
  if (errSel) throw new Error(errSel.message);
  return new Map((data ?? []).map((c) => [c.tiktok_buyer_id as string, c.id as string]));
}

/* Inserta renglones nuevos, refresca estado y retira los de canceladas. */
async function aplicarOrdenes(ordenes: OrdenTikTok[]): Promise<ResumenVentasTikTok> {
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
  if (filas.length > 0) {
    const { data, error } = await admin
      .from("sales")
      .upsert(filas, { onConflict: "canal,referencia_externa", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    insertadas = data?.length ?? 0;

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

    // Estado de envío: TikTok es la fuente de verdad; se refresca SIEMPRE.
    // En tandas de 200 (un .in() enorme rompe la URL — lección de ML).
    const porEstado = new Map<string, string[]>();
    for (const f of filas) {
      (porEstado.get(f.estado) ?? porEstado.set(f.estado, []).get(f.estado)!).push(f.referencia_externa);
    }
    for (const [estado, refs] of porEstado) {
      for (let i = 0; i < refs.length; i += 200) {
        const { error } = await admin
          .from("sales")
          .update({ estado })
          .eq("canal", "tiktok_shop")
          .eq("origen", "api")
          .in("referencia_externa", refs.slice(i, i + 200));
        if (error) console.error("[tiktok] refresco de estado:", error.message);
      }
    }
  }

  const refsCanceladas = ordenes
    .filter(estaCancelada)
    .flatMap((o) => (o.line_items ?? []).map((li) => refLinea(o.id, li.id)));
  let retiradas = 0;
  if (refsCanceladas.length > 0) {
    for (let i = 0; i < refsCanceladas.length; i += 200) {
      const { data, error } = await admin
        .from("sales")
        .delete()
        .eq("canal", "tiktok_shop")
        .in("referencia_externa", refsCanceladas.slice(i, i + 200))
        .select("id");
      if (error) throw new Error(error.message);
      retiradas += data?.length ?? 0;
    }
  }

  return {
    ordenes: ordenes.length,
    insertadas,
    existentes: filas.length - insertadas,
    retiradas,
    clientes: clientes.size,
  };
}

/* Importación por ventana de fechas (cron / botón). */
export async function importarVentasTikTok(
  cxParam?: ConexionTikTok,
  opts?: { completo?: boolean },
): Promise<ResumenVentasTikTok> {
  const cx = cxParam ?? (await conexionTiktok());
  if (!cx) throw new Error("TikTok Shop no está conectado.");

  const datos = await leerDatosIntegracion("tiktok");
  const ultimaSync =
    !opts?.completo && typeof datos.ventas_ultima_sync === "string" ? datos.ventas_ultima_sync : null;

  const base = ultimaSync ? Date.parse(ultimaSync) : Date.now();
  const dias = ultimaSync ? DIAS_TRASLAPE : DIAS_PRIMERA_VEZ;
  const desdeUnix = Math.floor((base - dias * 24 * 60 * 60 * 1000) / 1000);

  const ordenes = await listarOrdenesTikTok(cx, desdeUnix);
  const resumen = await aplicarOrdenes(ordenes);

  await mezclarDatosIntegracion("tiktok", { ventas_ultima_sync: new Date().toISOString() }, datos);

  return resumen;
}

/* Procesa UNA orden avisada por webhook. */
export async function procesarOrdenTikTok(orderId: string): Promise<void> {
  const cx = await conexionTiktok();
  if (!cx) return;
  const orden = await obtenerOrdenTikTok(cx, orderId);
  if (!orden) return;
  await aplicarOrdenes([orden]);
}
