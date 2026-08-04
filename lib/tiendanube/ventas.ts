/* ============================================================================
   lib/tiendanube/ventas.ts — Importación de ventas desde Tienda Nube
   ----------------------------------------------------------------------------
   Convierte órdenes PAGADAS en renglones de `sales` (un renglón por producto
   vendido). Idempotente: referencia_externa = "<order_id>:<variant_id>" con
   UNIQUE (canal, referencia_externa) — webhook, cron y botón pueden correr
   juntos sin duplicar. Las órdenes canceladas retiran sus renglones.
   Solo servidor (service role).
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/canales/paginacion";
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
import { leerDatosIntegracion, mezclarDatosIntegracion } from "@/lib/canales/integraciones";
import { HUB_VENTAS_ACTIVO, productosDelPiloto } from "@/lib/inventario/hub-config";
import { propagarStock, type FilaVinculada } from "@/lib/inventario/stock-hub";
import {
  conexionTiendanube,
  dominioAdminTN,
  listarOrdenesTN,
  obtenerOrdenTN,
  type ConexionTN,
  type OrdenTN,
} from "@/lib/tiendanube/api";

export type ResumenVentasTN = {
  ordenes: number;
  insertadas: number;
  actualizadas: number; // renglones ya importados que se corrigieron (fecha, monto, envío)
  existentes: number;
  retiradas: number; // renglones eliminados por órdenes canceladas
  clientes: number; // clientes creados o actualizados desde las órdenes
};

/* Primera importación: últimos 90 días. Después: desde la última sync menos
   un traslape de 7 días (los duplicados los absorbe el UNIQUE). */
const DIAS_PRIMERA_VEZ = 90;
const DIAS_TRASLAPE = 7;

function esVendible(o: OrdenTN): boolean {
  return o.payment_status === "paid" && o.status !== "cancelled";
}

function estaCancelada(o: OrdenTN): boolean {
  return o.status === "cancelled" || o.payment_status === "refunded" || o.payment_status === "voided";
}

/* Correo del comprador, normalizado: es la llave con la que se identifica al
   cliente (Tienda Nube no expone un id de cliente en sus órdenes). */
function correoDe(orden: OrdenTN): string | null {
  const c = orden.contact_email?.trim().toLowerCase();
  return c || null;
}

/* shipping_status de Tienda Nube → estado de pedido del CRM. */
function estadoDeEnvio(orden: OrdenTN): "nuevo" | "preparando" | "enviado" | "entregado" {
  switch (orden.shipping_status) {
    case "delivered":
      return "entregado";
    case "shipped":
      return "enviado";
    case "unshipped": // empacado, en espera de recolección
      return "preparando";
    default: // unpacked / null → recién llegado
      return "nuevo";
  }
}

/* Día de la venta, en hora de México. `paid_at`/`created_at` vienen con el huso
   de la tienda; cortarlos con slice(0,10) dejaba la venta en el día equivocado y
   descuadraba los totales por rango contra el panel de Tienda Nube. */
function fechaDe(orden: OrdenTN): string {
  return diaMX(orden.paid_at ?? orden.created_at);
}

/* Medio de pago en palabras. `payment_details.method` viene en inglés y sin la
   tarjeta; se junta con la marca para que "credit_card + visa" se lea como el
   equipo lo diría. */
const METODOS: Record<string, string> = {
  credit_card: "Tarjeta de crédito",
  debit_card: "Tarjeta de débito",
  cash: "Efectivo",
  bank_transfer: "Transferencia",
  ticket: "Pago en tienda",
  wallet: "Monedero",
  boleto: "Pago en tienda",
};

function pagoDe(orden: OrdenTN): { metodo_pago: string | null; meses: number | null } {
  const d = orden.payment_details;
  const base = d?.method ? (METODOS[d.method] ?? d.method) : null;
  const marca = d?.credit_card_company?.trim();
  const metodo = base
    ? marca && base.startsWith("Tarjeta")
      ? `${base} · ${marca}`
      : base
    : (orden.gateway_name?.trim() || null);
  const meses = Number(d?.installments);
  return { metodo_pago: metodo, meses: Number.isFinite(meses) && meses > 0 ? meses : null };
}

/* Totales de la orden tal como los reporta el panel de Tienda Nube: `total` ya
   trae envío y descuentos aplicados, que `sales.monto` no incluye. */
function totalDeOrden(orden: OrdenTN, clienteId: string | null): TotalOrden {
  const envio = aMonto(orden.shipping_cost_customer);
  const descuento = aMonto(orden.discount) + aMonto(orden.promotional_discount);
  const total = aMonto(orden.total);
  const subtotal = orden.subtotal != null ? aMonto(orden.subtotal) : total - envio + descuento;
  return {
    canal: "tienda_nube",
    referencia_orden: String(orden.id),
    numero: orden.number != null ? String(orden.number) : null,
    fecha: fechaDe(orden),
    total,
    subtotal,
    envio,
    descuento,
    impuesto: 0, // Tienda Nube entrega los precios con impuesto incluido.
    moneda: orden.currency?.trim() || "MXN",
    estado: orden.status ?? null,
    cliente_id: clienteId,
    ...pagoDe(orden),
    cupon: orden.coupon?.find((c) => c?.code)?.code?.trim() || null,
  };
}

/* Dirección de envío de la orden, traducida al formato común del CRM. */
function direccionDe(orden: OrdenTN): DireccionEnvio | null {
  const d = orden.shipping_address;
  if (!d) return null;
  return normalizarDireccion({
    nombre: d.name ?? orden.contact_name,
    telefono: d.phone ?? orden.contact_phone,
    calle: d.address,
    numero: d.number,
    colonia: d.locality,
    ciudad: d.city,
    estado: d.province,
    cp: d.zipcode,
    pais: d.country,
    referencias: d.floor,
  });
}

/* Paquetería, guía y enlace de rastreo de la orden.

   En la API 2025-03 esto vive en `fulfillments`, no en los campos planos
   `shipping_carrier_name` / `shipping_tracking_number` que el CRM venía leyendo
   (y que solo se rellenaban en la v1). El resultado era que TODOS los pedidos de
   Tienda Nube aparecían como "Agregar guía" aunque la tienda sí la tuviera: 0 de
   329 en julio, contra 129 órdenes con rastreo del lado de Tienda Nube.

   Una orden puede tener varios paquetes; se toma el primero que traiga guía. El
   nombre del transportista suele venir genérico en el fulfillment ("Envío
   estándar"), así que se prefiere `shipping_option`, que sí dice cuál es
   ("Envío Nube - Estafeta Terrestre"). La URL la da la propia plataforma: mejor
   esa que adivinarla a partir del nombre. */
function envioDe(orden: OrdenTN): {
  paqueteria: string | null;
  num_guia: string | null;
  url_rastreo: string | null;
} {
  const conGuia = (orden.fulfillments ?? []).find((f) => f?.tracking_info?.code?.trim());
  const guia =
    conGuia?.tracking_info?.code?.trim() || orden.shipping_tracking_number?.trim() || null;
  const nombre =
    orden.shipping_option?.trim() ||
    conGuia?.shipping?.option?.name?.trim() ||
    conGuia?.shipping?.carrier?.name?.trim() ||
    orden.shipping_carrier_name?.trim() ||
    null;
  return {
    paqueteria: guia ? nombre : null, // sin guía, el nombre del envío no ayuda a nadie
    num_guia: guia,
    url_rastreo: conGuia?.tracking_info?.url?.trim() || null,
  };
}

/* Renglones de `sales` de una orden (la orden ya debe ser vendible). */
function filasDeOrden(
  orden: OrdenTN,
  productoPorVariante: Map<number, string>,
  clientePorCorreo: Map<string, string>,
) {
  const fecha = fechaDe(orden);
  const direccion = direccionDe(orden);
  const cliente = orden.contact_name?.trim();
  const correo = correoDe(orden);
  const clienteId = correo ? (clientePorCorreo.get(correo) ?? null) : null;
  const estado = estadoDeEnvio(orden);
  const envio = envioDe(orden);
  return (orden.products ?? []).map((linea) => {
    const cantidad = Math.max(1, Math.trunc(Number(linea.quantity) || 1));
    const unitario = Number(linea.price) || 0;
    return {
      fecha,
      canal: "tienda_nube",
      producto_id: productoPorVariante.get(linea.variant_id) ?? null,
      descripcion: linea.name || null,
      cantidad,
      monto: Math.round(unitario * cantidad * 100) / 100,
      cliente_id: clienteId,
      estado,
      paqueteria: envio.paqueteria,
      num_guia: envio.num_guia,
      url_rastreo: envio.url_rastreo,
      envio_direccion: direccion,
      origen: "api",
      referencia_externa: `${orden.id}:${linea.variant_id}`,
      notas: `Orden TN #${orden.number}${cliente ? ` — ${cliente}` : ""}`,
    };
  });
}

/* Crea/actualiza los clientes de las órdenes y devuelve el mapa
   correo → id de cliente del CRM. Así el historial de compras se llena solo:
   nadie captura clientes a mano. */
async function sincronizarClientes(ordenes: OrdenTN[]): Promise<Map<string, string>> {
  const admin = createAdminClient();

  /* Un cliente por correo; se queda con el nombre/teléfono de su orden más
     reciente (las órdenes llegan de la más nueva a la más vieja). De ahí sale
     también de dónde es, que es lo que permite ver a qué parte del país se
     vende más. */
  const porCorreo = new Map<
    string,
    { nombre: string; telefono: string | null; ciudad: string | null; estado: string | null; cp: string | null }
  >();
  for (const o of ordenes) {
    const correo = correoDe(o);
    if (!correo || porCorreo.has(correo)) continue;
    const d = direccionDe(o);
    porCorreo.set(correo, {
      nombre: o.contact_name?.trim() || correo,
      telefono: o.contact_phone?.trim() || null,
      ciudad: d?.ciudad ?? null,
      estado: d?.estado ?? null,
      cp: d?.cp ?? null,
    });
  }
  if (porCorreo.size === 0) return new Map();

  const filas = [...porCorreo.entries()].map(([correo, c]) => ({
    correo,
    nombre: c.nombre,
    telefono: c.telefono,
    ciudad: c.ciudad,
    estado: c.estado,
    cp: c.cp,
    canal: "tienda_nube",
  }));

  /* Upsert por correo: el contacto se refresca desde la tienda; `notas` no se
     toca (es del equipo) porque no va en el payload.

     En tandas: reimportar el histórico completo son cientos de compradores, y
     un `.in()` con todos ellos arma una URL que el servidor rechaza con 400
     (la misma lección que ya llevaba anotada el importador de Mercado Libre).
     Con la ventana corta del cron diario nunca se notaba. */
  const LOTE = 200;
  const correos = [...porCorreo.keys()];
  const mapa = new Map<string, string>();

  for (let i = 0; i < filas.length; i += LOTE) {
    const { error } = await admin
      .from("customers")
      .upsert(filas.slice(i, i + LOTE), { onConflict: "correo" });
    if (error) throw new Error(error.message);
  }

  for (let i = 0; i < correos.length; i += LOTE) {
    const { data, error: errSel } = await admin
      .from("customers")
      .select("id, correo")
      .in("correo", correos.slice(i, i + LOTE));
    if (errSel) throw new Error(errSel.message);
    for (const c of data ?? []) mapa.set(c.correo as string, c.id as string);
  }

  return mapa;
}

/* Mapa variante de Tienda Nube → id de producto del CRM. Con pocas variantes
   en juego (webhook de una orden) trae SOLO esas filas; con muchas (sync
   completa) carga la tabla entera, paginada con traerTodo para que PostgREST
   no la trunque en ~1000 filas sin avisar. */
async function mapaVariantes(variantIds: number[]): Promise<Map<number, string>> {
  const admin = createAdminClient();
  const ids = [...new Set(variantIds)];
  const acotado = ids.length <= 50;
  const data = await traerTodo<{ id: string; tiendanube_variant_id: number }>((desde, hasta) => {
    const q = admin
      .from("products")
      .select("id, tiendanube_variant_id")
      .not("tiendanube_variant_id", "is", null);
    return (acotado ? q.in("tiendanube_variant_id", ids) : q).range(desde, hasta);
  });
  return new Map(data.map((p) => [p.tiendanube_variant_id as number, p.id as string]));
}

/* Inserta los renglones nuevos (ignora los ya importados) y retira los de
   órdenes canceladas. Núcleo compartido por el botón, el cron y el webhook. */
async function aplicarOrdenes(ordenes: OrdenTN[]): Promise<ResumenVentasTN> {
  const admin = createAdminClient();
  const vendibles = ordenes.filter(esVendible);
  const [variantes, clientes] = await Promise.all([
    mapaVariantes(vendibles.flatMap((o) => (o.products ?? []).map((l) => l.variant_id))),
    sincronizarClientes(vendibles),
  ]);

  const filas = vendibles.flatMap((o) => filasDeOrden(o, variantes, clientes));
  let insertadas = 0;
  let actualizadas = 0;
  if (filas.length > 0) {
    const { data, error } = await admin
      .from("sales")
      .upsert(filas, { onConflict: "canal,referencia_externa", ignoreDuplicates: true })
      .select("id, producto_id, cantidad");
    if (error) throw new Error(error.message);
    insertadas = data?.length ?? 0;

    /* Hub padre-hijo (solo con el flag activo): la venta de Tienda Nube descuenta
       el stock del CRM y el movimiento se empuja a los demás canales.

       Tienda Nube ya descontó lo suyo al vender, igual que hace Mercado Libre
       con las suyas; por eso el origen es "tiendanube" y el hub no le reenvía
       nada a ella, solo a los otros canales.

       `ignoreDuplicates` hace que `data` sean solo las ventas NUEVAS, así los
       reintentos de webhook o cron no vuelven a descontar. */
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
            p_origen: "venta_tn",
          });
          if (errDesc) throw new Error(errDesc.message);
          const filasHub = ((afectados ?? []) as (FilaVinculada & { descontado?: number })[]).map(
            (f) => ({ ...f, delta: f.descontado ? -f.descontado : null }),
          );
          if (filasHub.length > 0) {
            (await propagarStock("tiendanube", filasHub, "venta_tn")).forEach((e) =>
              console.error("[stock-hub] venta TN→ML:", e),
            );
          }
        } catch (e) {
          console.error("[tiendanube] descuento de stock por venta:", e);
        }
      }
    }

    /* Ventas ya importadas antes de que existieran los clientes: se les liga
       el cliente ahora (el upsert de arriba las ignora por duplicadas). Solo
       toca las que no tienen cliente: nunca pisa una asignación manual. */
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
        .eq("canal", "tienda_nube")
        .is("cliente_id", null)
        .in("referencia_externa", refs);
    }

    /* Refrescar los renglones que YA estaban importados. Tienda Nube es la
       fuente de verdad del fulfillment, así que el estado y la guía se releen
       en cada sync; y como el upsert de arriba ignora los duplicados, éste es
       también el único momento en que se corrige la FECHA de lo ya guardado
       (los renglones viejos se importaron con el día sin convertir a México).
       Solo toca `origen = 'api'`: las ventas de mostrador son del equipo. */
    actualizadas = await refrescarRenglones(
      "tienda_nube",
      filas.map((f) => ({
        referencia_externa: f.referencia_externa,
        fecha: f.fecha,
        monto: f.monto,
        cantidad: f.cantidad,
        estado: f.estado,
        paqueteria: f.paqueteria,
        num_guia: f.num_guia,
        url_rastreo: f.url_rastreo,
        envio_direccion: f.envio_direccion,
      })),
    );
  }

  /* Totales por orden: es lo que reporta el panel de Tienda Nube (con envío y
     descuentos), y de aquí sale el KPI de ventas de Métricas. */
  await guardarTotalesOrden(
    vendibles.map((o) => {
      const correo = correoDe(o);
      return totalDeOrden(o, correo ? (clientes.get(correo) ?? null) : null);
    }),
  );

  // Órdenes canceladas/reembolsadas: retirar sus renglones si se importaron.
  const refsCanceladas = ordenes
    .filter(estaCancelada)
    .flatMap((o) => (o.products ?? []).map((l) => `${o.id}:${l.variant_id}`));
  let retiradas = 0;
  if (refsCanceladas.length > 0) {
    const { data, error } = await admin
      .from("sales")
      .delete()
      .eq("canal", "tienda_nube")
      .in("referencia_externa", refsCanceladas)
      .select("id, producto_id, cantidad");
    if (error) throw new Error(error.message);
    retiradas = data?.length ?? 0;

    /* Devolver el stock de lo cancelado (simétrico al descuento por venta):
       cancelar una venta suma la unidad de vuelta. `data` son solo los renglones
       que EXISTÍAN y se acaban de borrar, así que una segunda notificación de la
       misma cancelación no encuentra nada y no devuelve dos veces.

       Tienda Nube ya restituyó lo suyo al cancelar; por eso el origen es
       "tiendanube" y el hub reenvía el +N solo a los demás canales, no a ella. */
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
            p_origen: "cancelacion_tn",
          });
          if (errDev) throw new Error(errDev.message);
          const filasHub = ((afectados ?? []) as (FilaVinculada & { devuelto?: number })[]).map(
            (f) => ({ ...f, delta: f.devuelto ? f.devuelto : null }),
          );
          if (filasHub.length > 0) {
            (await propagarStock("tiendanube", filasHub, "cancelacion_tn")).forEach((e) =>
              console.error("[stock-hub] cancelación TN→ML:", e),
            );
          }
        } catch (e) {
          console.error("[tiendanube] devolución de stock por cancelación:", e);
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

/* Importación por ventana de fechas (botón "Importar ventas" y cron diario).
   `completo` rescanea los 90 días aunque ya haya habido syncs: sirve para
   rellenar datos nuevos (p. ej. ligar clientes a ventas ya importadas). */
export async function importarVentasTN(
  cxParam?: ConexionTN,
  opts?: OpcionesImportacion,
): Promise<ResumenVentasTN> {
  const cx = cxParam ?? (await conexionTiendanube());
  if (!cx) throw new Error("Tienda Nube no está conectada.");

  const datos = await leerDatosIntegracion("tiendanube");
  const ultimaSync =
    !opts?.completo && typeof datos.ventas_ultima_sync === "string" ? datos.ventas_ultima_sync : null;

  const desde = ventanaDesde(ultimaSync, opts, DIAS_PRIMERA_VEZ, DIAS_TRASLAPE);

  const ordenes = await listarOrdenesTN(cx, desde.toISOString());
  const resumen = await aplicarOrdenes(ordenes);

  /* De paso, el dominio del panel: lo necesita el enlace "ver la orden en Tienda
     Nube" de Pedidos, y cambia tan poco que basta refrescarlo con cada sync. */
  const dominio = await dominioAdminTN(cx).catch(() => null);

  await mezclarDatosIntegracion(
    "tiendanube",
    {
      ventas_ultima_sync: new Date().toISOString(),
      ...(dominio ? { dominio_admin: dominio } : {}),
    },
    datos,
  );

  return resumen;
}

/* Procesa UNA orden avisada por webhook (order/paid u order/cancelled). */
export async function procesarOrdenTN(orderId: number): Promise<void> {
  const cx = await conexionTiendanube();
  if (!cx) return;
  const orden = await obtenerOrdenTN(cx, orderId);
  if (!orden) return;
  await aplicarOrdenes([orden]);
}
