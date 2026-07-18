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
import {
  conexionMercadolibre,
  listarOrdenesML,
  obtenerEnvioML,
  obtenerOrdenML,
  type ConexionML,
  type EnvioML,
  type OrdenML,
} from "@/lib/mercadolibre/api";
import { HUB_VENTAS_ACTIVO } from "@/lib/inventario/hub-config";
import { propagarStock, type FilaVinculada } from "@/lib/inventario/stock-hub";

export type ResumenVentasML = {
  ordenes: number;
  insertadas: number;
  existentes: number;
  retiradas: number; // renglones eliminados por órdenes canceladas
  clientes: number; // clientes creados o actualizados desde las órdenes
};

/* Primera importación: últimos 90 días. Después: desde la última sync menos
   un traslape de 7 días (los duplicados los absorbe el UNIQUE). */
const DIAS_PRIMERA_VEZ = 90;
const DIAS_TRASLAPE = 7;

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

type EstadoPedido = "nuevo" | "preparando" | "enviado" | "entregado";
type InfoEnvio = { estado: EstadoPedido; paqueteria: string | null; num_guia: string | null };

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

/* Resuelve el estado de envío de un lote de órdenes. Las que los `tags` marcan
   como entregadas no consultan el envío (ahorra llamadas en el histórico); las
   demás piden /shipments/{id} con concurrencia acotada. Nunca lanza: sin dato,
   el pedido queda "nuevo". */
async function infoEnvioDeOrdenes(cx: ConexionML, ordenes: OrdenML[]): Promise<Map<number, InfoEnvio>> {
  const info = new Map<number, InfoEnvio>();
  const porConsultar: OrdenML[] = [];
  for (const o of ordenes) {
    if (o.tags?.includes("delivered")) {
      info.set(o.id, { estado: "entregado", paqueteria: null, num_guia: null });
    } else if (o.shipping?.id) {
      porConsultar.push(o);
    } else {
      info.set(o.id, { estado: "nuevo", paqueteria: null, num_guia: null });
    }
  }

  const CONCURRENCIA = 8;
  for (let i = 0; i < porConsultar.length; i += CONCURRENCIA) {
    await Promise.all(
      porConsultar.slice(i, i + CONCURRENCIA).map(async (o) => {
        const env = await obtenerEnvioML(cx, o.shipping!.id!);
        info.set(o.id, {
          estado: estadoDeEnvio(env),
          paqueteria: env?.tracking_method?.trim() || null,
          num_guia: env?.tracking_number?.trim() || null,
        });
      }),
    );
  }
  return info;
}

/* Renglones de `sales` de una orden (la orden ya debe ser vendible). */
function filasDeOrden(
  orden: OrdenML,
  productoPorUnidad: Map<string, string>,
  clientePorBuyer: Map<number, string>,
  infoEnvio: Map<number, InfoEnvio>,
) {
  const fecha = (orden.date_closed ?? orden.date_created).slice(0, 10);
  const cliente = nombreComprador(orden);
  const clienteId = orden.buyer ? (clientePorBuyer.get(orden.buyer.id) ?? null) : null;
  const envio = infoEnvio.get(orden.id) ?? { estado: "nuevo" as EstadoPedido, paqueteria: null, num_guia: null };
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
      origen: "api",
      referencia_externa: refLinea(orden.id, linea.item.id, variationId),
      notas: `Orden ML #${orden.id}${cliente ? ` — ${cliente}` : ""}`,
    };
  });
}

/* Mapa unidad de Mercado Libre → id de producto del CRM. */
async function mapaUnidades(): Promise<Map<string, string>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products")
    .select("id, meli_item_id, meli_variation_id")
    .not("meli_item_id", "is", null);
  if (error) throw new Error(error.message);
  const m = new Map<string, string>();
  for (const p of data ?? []) {
    m.set(claveUnidad(p.meli_item_id as string, (p.meli_variation_id as number | null) ?? null), p.id as string);
  }
  return m;
}

/* Crea/actualiza los clientes de las órdenes y devuelve buyer_id → id de
   cliente del CRM. El correo NO se guarda a propósito: ML lo anonimiza y
   escribirlo podría chocar con el índice único de `correo` (clientes de TN).
   El comprador se identifica solo por su buyer_id. */
async function sincronizarClientes(ordenes: OrdenML[]): Promise<Map<number, string>> {
  const admin = createAdminClient();

  /* Un cliente por buyer; se queda con el nombre de su orden más reciente
     (las órdenes llegan de la más nueva a la más vieja). */
  const porBuyer = new Map<number, string>();
  for (const o of ordenes) {
    const b = o.buyer;
    if (!b?.id || porBuyer.has(b.id)) continue;
    porBuyer.set(b.id, nombreComprador(o) || `ML ${b.id}`);
  }
  if (porBuyer.size === 0) return new Map();

  const filas = [...porBuyer.entries()].map(([buyerId, nombre]) => ({
    mercadolibre_buyer_id: buyerId,
    nombre,
    canal: "mercado_libre",
  }));

  const { error } = await admin.from("customers").upsert(filas, { onConflict: "mercadolibre_buyer_id" });
  if (error) throw new Error(error.message);

  const { data, error: errSel } = await admin
    .from("customers")
    .select("id, mercadolibre_buyer_id")
    .in("mercadolibre_buyer_id", [...porBuyer.keys()]);
  if (errSel) throw new Error(errSel.message);

  return new Map((data ?? []).map((c) => [c.mercadolibre_buyer_id as number, c.id as string]));
}

/* Inserta los renglones nuevos (ignora los ya importados) y retira los de
   órdenes canceladas. Núcleo compartido por el cron y el webhook. */
async function aplicarOrdenes(cx: ConexionML, ordenes: OrdenML[]): Promise<ResumenVentasML> {
  const admin = createAdminClient();
  const vendibles = ordenes.filter(esVendible);

  const unidades = await mapaUnidades();
  // La sync de clientes NUNCA tira la importación: registrar la venta es lo
  // prioritario (y la columna mercadolibre_buyer_id podría no estar aún).
  let clientes = new Map<number, string>();
  try {
    clientes = await sincronizarClientes(vendibles);
  } catch (e) {
    console.error("[mercadolibre] sync de clientes:", e);
  }

  const infoEnvio = await infoEnvioDeOrdenes(cx, vendibles);
  const filas = vendibles.flatMap((o) => filasDeOrden(o, unidades, clientes, infoEnvio));
  let insertadas = 0;
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
      const aDescontar = (data ?? [])
        .filter((r) => r.producto_id)
        .map((r) => ({ producto_id: r.producto_id as string, cantidad: r.cantidad as number }));
      if (aDescontar.length > 0) {
        try {
          const { data: afectados, error: errDesc } = await admin.rpc("descontar_stock_ventas", {
            items: aDescontar,
            p_origen: "venta_ml",
          });
          if (errDesc) throw new Error(errDesc.message);
          const filasHub = (afectados ?? []) as FilaVinculada[];
          if (filasHub.length > 0) {
            // origen "mercadolibre" = no reenviar a ML (ya se descontó allá); sí a TN.
            (await propagarStock("mercadolibre", filasHub)).forEach((e) =>
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

    /* Estado/guía de envío: Mercado Libre es la fuente de verdad del
       fulfillment, así que se refresca SIEMPRE en cada sync (el upsert ignora
       las filas ya existentes, por eso este UPDATE es lo que hace que un pedido
       avance de nuevo→preparando→enviado→entregado). Agrupado por estado para
       hacer pocos UPDATE; `origen=api` no toca ventas manuales/de mostrador. */
    const porEstado = new Map<string, string[]>();
    for (const f of filas) {
      const lista = porEstado.get(f.estado) ?? [];
      lista.push(f.referencia_externa);
      porEstado.set(f.estado, lista);
    }
    // En tandas: un `.in()` con cientos de refs arma una URL que supera el
    // límite del servidor y falla en silencio (el histórico entregado son
    // ~700 renglones). 200 por lote mantiene la URL corta.
    for (const [estado, refs] of porEstado) {
      for (let i = 0; i < refs.length; i += 200) {
        const { error } = await admin
          .from("sales")
          .update({ estado })
          .eq("canal", "mercado_libre")
          .eq("origen", "api")
          .in("referencia_externa", refs.slice(i, i + 200));
        if (error) console.error("[mercadolibre] refresco de estado:", error.message);
      }
    }
  }

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
      .select("id");
    if (error) throw new Error(error.message);
    retiradas = data?.length ?? 0;
  }

  return {
    ordenes: ordenes.length,
    insertadas,
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
  opts?: { completo?: boolean },
): Promise<ResumenVentasML> {
  const cx = cxParam ?? (await conexionMercadolibre());
  if (!cx) throw new Error("Mercado Libre no está conectado.");

  const admin = createAdminClient();
  const { data: fila } = await admin.from("integraciones").select("datos").eq("id", "mercadolibre").maybeSingle();
  const datos = (fila?.datos ?? {}) as Record<string, unknown>;
  const ultimaSync =
    !opts?.completo && typeof datos.ventas_ultima_sync === "string" ? datos.ventas_ultima_sync : null;

  const desde = new Date(ultimaSync ?? Date.now());
  desde.setDate(desde.getDate() - (ultimaSync ? DIAS_TRASLAPE : DIAS_PRIMERA_VEZ));

  const ordenes = await listarOrdenesML(cx, desde.toISOString());
  const resumen = await aplicarOrdenes(cx, ordenes);

  await admin
    .from("integraciones")
    .update({ datos: { ...datos, ventas_ultima_sync: new Date().toISOString() } })
    .eq("id", "mercadolibre");

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
