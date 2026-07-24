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
import { HUB_VENTAS_ACTIVO, productosDelPiloto } from "@/lib/inventario/hub-config";
import { propagarStock, type FilaVinculada } from "@/lib/inventario/stock-hub";
import {
  conexionTiendanube,
  listarOrdenesTN,
  obtenerOrdenTN,
  type ConexionTN,
  type OrdenTN,
} from "@/lib/tiendanube/api";

export type ResumenVentasTN = {
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

/* Renglones de `sales` de una orden (la orden ya debe ser vendible). */
function filasDeOrden(
  orden: OrdenTN,
  productoPorVariante: Map<number, string>,
  clientePorCorreo: Map<string, string>,
) {
  const fecha = (orden.paid_at ?? orden.created_at).slice(0, 10);
  const cliente = orden.contact_name?.trim();
  const correo = correoDe(orden);
  const clienteId = correo ? (clientePorCorreo.get(correo) ?? null) : null;
  const estado = estadoDeEnvio(orden);
  const paqueteria = orden.shipping_carrier_name?.trim() || null;
  const numGuia = orden.shipping_tracking_number?.trim() || null;
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
      paqueteria,
      num_guia: numGuia,
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
     reciente (las órdenes llegan de la más nueva a la más vieja). */
  const porCorreo = new Map<string, { nombre: string; telefono: string | null }>();
  for (const o of ordenes) {
    const correo = correoDe(o);
    if (!correo || porCorreo.has(correo)) continue;
    porCorreo.set(correo, {
      nombre: o.contact_name?.trim() || correo,
      telefono: o.contact_phone?.trim() || null,
    });
  }
  if (porCorreo.size === 0) return new Map();

  const filas = [...porCorreo.entries()].map(([correo, c]) => ({
    correo,
    nombre: c.nombre,
    telefono: c.telefono,
    canal: "tienda_nube",
  }));

  /* Upsert por correo: el contacto se refresca desde la tienda; `notas` no se
     toca (es del equipo) porque no va en el payload. */
  const { error } = await admin.from("customers").upsert(filas, { onConflict: "correo" });
  if (error) throw new Error(error.message);

  const { data, error: errSel } = await admin
    .from("customers")
    .select("id, correo")
    .in("correo", [...porCorreo.keys()]);
  if (errSel) throw new Error(errSel.message);

  return new Map((data ?? []).map((c) => [c.correo as string, c.id as string]));
}

/* Mapa variante de Tienda Nube → id de producto del CRM. */
async function mapaVariantes(): Promise<Map<number, string>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products")
    .select("id, tiendanube_variant_id")
    .not("tiendanube_variant_id", "is", null);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((p) => [p.tiendanube_variant_id as number, p.id as string]));
}

/* Inserta los renglones nuevos (ignora los ya importados) y retira los de
   órdenes canceladas. Núcleo compartido por el botón, el cron y el webhook. */
async function aplicarOrdenes(ordenes: OrdenTN[]): Promise<ResumenVentasTN> {
  const admin = createAdminClient();
  const vendibles = ordenes.filter(esVendible);
  const [variantes, clientes] = await Promise.all([
    mapaVariantes(),
    sincronizarClientes(vendibles),
  ]);

  const filas = vendibles.flatMap((o) => filasDeOrden(o, variantes, clientes));
  let insertadas = 0;
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

    /* Estado/guía de envío: Tienda Nube es la fuente de verdad del fulfillment
       de los pedidos online, así que se refresca SIEMPRE en cada sync (no solo
       al crear). Agrupado por estado para hacer pocos UPDATE. El estado de las
       ventas manuales / de mostrador lo maneja el equipo y no se toca aquí. */
    const porEstado = new Map<string, string[]>();
    for (const f of filas) {
      const lista = porEstado.get(f.estado) ?? [];
      lista.push(f.referencia_externa);
      porEstado.set(f.estado, lista);
    }
    for (const [estado, refs] of porEstado) {
      await admin
        .from("sales")
        .update({ estado })
        .eq("canal", "tienda_nube")
        .eq("origen", "api")
        .in("referencia_externa", refs);
    }
  }

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
  opts?: { completo?: boolean },
): Promise<ResumenVentasTN> {
  const cx = cxParam ?? (await conexionTiendanube());
  if (!cx) throw new Error("Tienda Nube no está conectada.");

  const admin = createAdminClient();
  const { data: fila } = await admin.from("integraciones").select("datos").eq("id", "tiendanube").maybeSingle();
  const datos = (fila?.datos ?? {}) as Record<string, unknown>;
  const ultimaSync =
    !opts?.completo && typeof datos.ventas_ultima_sync === "string" ? datos.ventas_ultima_sync : null;

  const desde = new Date(ultimaSync ?? Date.now());
  desde.setDate(desde.getDate() - (ultimaSync ? DIAS_TRASLAPE : DIAS_PRIMERA_VEZ));

  const ordenes = await listarOrdenesTN(cx, desde.toISOString());
  const resumen = await aplicarOrdenes(ordenes);

  await admin
    .from("integraciones")
    .update({ datos: { ...datos, ventas_ultima_sync: new Date().toISOString() } })
    .eq("id", "tiendanube");

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
