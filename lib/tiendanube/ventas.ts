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
import { upsertClientesPorClave } from "@/lib/canales/clientes";
import {
  aMonto,
  guardarTotalesOrden,
  refrescarRenglones,
  separarAltas,
  ventanaDesde,
  type OpcionesImportacion,
  type TotalOrden,
} from "@/lib/canales/ventas-cuadre";
import { diaMX } from "@/lib/fecha";
import { normalizarDireccion, type DireccionEnvio } from "@/lib/canales/direccion";
import { aplicarOrdenesMaquila } from "@/lib/maquila/ingesta";
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

function esVendible(o: OrdenTN): boolean {
  return o.payment_status === "paid" && o.status !== "cancelled";
}

function estaCancelada(o: OrdenTN): boolean {
  return o.status === "cancelled" || o.payment_status === "refunded" || o.payment_status === "voided";
}

/* Por qué se retiró la venta. El stock vuelve igual en los dos casos; lo que
   cambia es lo que queda escrito en el historial. */
type MotivoRetiro = "cancelacion_tn" | "reembolso_tn";

function motivoRetiro(o: OrdenTN): MotivoRetiro {
  /* `refunded` manda aunque la orden esté ADEMÁS cancelada: si el dinero ya se
     devolvió, eso es lo que describe el movimiento. `voided` —el pago se anuló
     sin llegar a capturarse— es una cancelación: nunca hubo dinero que volver. */
  return o.payment_status === "refunded" ? "reembolso_tn" : "cancelacion_tn";
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
  /* Un cliente por correo; se queda con el nombre/teléfono de su orden más
     reciente (las órdenes llegan de la más nueva a la más vieja). De ahí sale
     también de dónde es, que es lo que permite ver a qué parte del país se
     vende más. */
  const porCorreo = new Map<string, Record<string, unknown>>();
  for (const o of ordenes) {
    const correo = correoDe(o);
    if (!correo || porCorreo.has(correo)) continue;
    const d = direccionDe(o);
    porCorreo.set(correo, {
      correo,
      nombre: o.contact_name?.trim() || correo,
      telefono: o.contact_phone?.trim() || null,
      ciudad: d?.ciudad ?? null,
      estado: d?.estado ?? null,
      cp: d?.cp ?? null,
      canal: "tienda_nube",
    });
  }

  return upsertClientesPorClave<string>("correo", [...porCorreo.values()]);
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
async function aplicarOrdenes(
  ordenes: OrdenTN[],
  /* Corte de ALTAS: las órdenes anteriores solo se refrescan. Ver `separarAltas`.
     Sin él (webhook de una orden concreta) se da de alta todo. */
  altaDesde?: Date,
): Promise<ResumenVentasTN> {
  const admin = createAdminClient();
  const vendibles = ordenes.filter(esVendible);
  const [variantes, clientes] = await Promise.all([
    mapaVariantes(vendibles.flatMap((o) => (o.products ?? []).map((l) => l.variant_id))),
    sincronizarClientes(vendibles),
  ]);

  const filas = vendibles.flatMap((o) => filasDeOrden(o, variantes, clientes));
  const { altas, soloRefresco } = separarAltas(filas, altaDesde);
  if (soloRefresco > 0) {
    console.info(`[tiendanube] ${soloRefresco} renglones viejos: solo refresco, sin alta.`);
  }
  let insertadas = 0;
  let actualizadas = 0;
  if (filas.length > 0) {
    /* Solo las altas permitidas entran al upsert; el refresco de más abajo sí ve
       todos los renglones. Con `altas` vacío no hay nada que insertar (una pasada
       que solo trajo órdenes viejas actualizadas) y se salta la escritura. */
    let data: { id: string; producto_id: string | null; cantidad: number }[] | null = null;
    if (altas.length > 0) {
      const r = await admin
        .from("sales")
        .upsert(altas, { onConflict: "canal,referencia_externa", ignoreDuplicates: true })
        .select("id, producto_id, cantidad");
      if (r.error) throw new Error(r.error.message);
      data = r.data;
    }
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

  /* Órdenes retiradas: se agrupan POR MOTIVO. Para el stock da igual —las piezas
     vuelven en los dos casos—, pero para quien lee el historial no: una venta
     cancelada nunca ocurrió, una reembolsada sí ocurrió y se devolvió el dinero.
     Con un solo origen las dos se veían iguales. */
  const refsPorMotivo = new Map<MotivoRetiro, string[]>();
  for (const o of ordenes.filter(estaCancelada)) {
    const motivo = motivoRetiro(o);
    const refs = refsPorMotivo.get(motivo) ?? [];
    for (const l of o.products ?? []) refs.push(`${o.id}:${l.variant_id}`);
    refsPorMotivo.set(motivo, refs);
  }
  let retiradas = 0;
  for (const [motivo, refs] of refsPorMotivo) {
    if (refs.length === 0) continue;
    /* En tandas: una reimportación del histórico son cientos de referencias, y
       un `.in()` con todas arma una URL que el servidor rechaza con 400 (el
       mismo fallo que ya se corrigió en la sync de clientes). */
    const borrados: { producto_id: string | null; cantidad: number }[] = [];
    for (let i = 0; i < refs.length; i += 200) {
      const { data, error } = await admin
        .from("sales")
        .delete()
        .eq("canal", "tienda_nube")
        .in("referencia_externa", refs.slice(i, i + 200))
        .select("id, producto_id, cantidad");
      if (error) throw new Error(error.message);
      retiradas += data?.length ?? 0;
      for (const r of data ?? []) {
        borrados.push({ producto_id: r.producto_id as string | null, cantidad: r.cantidad as number });
      }
    }

    /* Devolver el stock de lo retirado (simétrico al descuento por venta):
       cancelar o reembolsar una venta suma la unidad de vuelta. `borrados` son
       solo los renglones que EXISTÍAN y se acaban de borrar, así que una segunda
       notificación de lo mismo no encuentra nada y no devuelve dos veces.

       Tienda Nube ya restituyó lo suyo al cancelar; por eso el origen es
       "tiendanube" y el hub reenvía el +N solo a los demás canales, no a ella. */
    if (HUB_VENTAS_ACTIVO) {
      const aDevolver = await productosDelPiloto(
        borrados
          .filter((r) => r.producto_id)
          .map((r) => ({ producto_id: r.producto_id as string, cantidad: r.cantidad })),
      );
      if (aDevolver.length > 0) {
        try {
          const { data: afectados, error: errDev } = await admin.rpc("devolver_stock_ventas", {
            items: aDevolver,
            p_origen: motivo,
          });
          if (errDev) throw new Error(errDev.message);
          const filasHub = ((afectados ?? []) as (FilaVinculada & { devuelto?: number })[]).map(
            (f) => ({ ...f, delta: f.devuelto ? f.devuelto : null }),
          );
          if (filasHub.length > 0) {
            (await propagarStock("tiendanube", filasHub, motivo)).forEach((e) =>
              console.error(`[stock-hub] ${motivo} TN→ML:`, e),
            );
          }
        } catch (e) {
          console.error("[tiendanube] devolución de stock por venta retirada:", e);
        }
      }
    }
  }

  /* Maquila México: los renglones cuyo producto tiene ficha de maquila van
     ADEMÁS al tablero de Eduardo — incluidas las órdenes pendientes de pago,
     que a `sales` nunca entran (bandeja "Esperando pago"). Va al final porque
     la promoción a producción liga la venta hermana recién upserteada, y en
     try/catch porque un tropiezo de maquila no puede tirar la importación de
     ventas, que es la que cuadra el dinero. */
  try {
    await aplicarOrdenesMaquila(ordenes);
  } catch (e) {
    console.error("[maquila] ingesta desde Tienda Nube:", e);
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

  const desde = ventanaDesde(ultimaSync, opts);

  /* `desde` cumple dos papeles: desde cuándo se piden órdenes ACTUALIZADAS, y
     hasta dónde se permite dar de alta ventas nuevas. Lo segundo mantiene el
     alcance de altas exactamente como era antes de mirar por actualización. */
  const ordenes = await listarOrdenesTN(cx, desde.toISOString());
  const resumen = await aplicarOrdenes(ordenes, desde);

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
