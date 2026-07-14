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

/* Renglones de `sales` de una orden (la orden ya debe ser vendible). */
function filasDeOrden(orden: OrdenTN, productoPorVariante: Map<number, string>) {
  const fecha = (orden.paid_at ?? orden.created_at).slice(0, 10);
  const cliente = orden.customer?.name?.trim();
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
      origen: "api",
      referencia_externa: `${orden.id}:${linea.variant_id}`,
      notas: `Orden TN #${orden.number}${cliente ? ` — ${cliente}` : ""}`,
    };
  });
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
  const variantes = await mapaVariantes();

  const filas = ordenes.filter(esVendible).flatMap((o) => filasDeOrden(o, variantes));
  let insertadas = 0;
  if (filas.length > 0) {
    const { data, error } = await admin
      .from("sales")
      .upsert(filas, { onConflict: "canal,referencia_externa", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    insertadas = data?.length ?? 0;
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
      .select("id");
    if (error) throw new Error(error.message);
    retiradas = data?.length ?? 0;
  }

  return {
    ordenes: ordenes.length,
    insertadas,
    existentes: filas.length - insertadas,
    retiradas,
  };
}

/* Importación por ventana de fechas (botón "Importar ventas" y cron diario). */
export async function importarVentasTN(cxParam?: ConexionTN): Promise<ResumenVentasTN> {
  const cx = cxParam ?? (await conexionTiendanube());
  if (!cx) throw new Error("Tienda Nube no está conectada.");

  const admin = createAdminClient();
  const { data: fila } = await admin.from("integraciones").select("datos").eq("id", "tiendanube").maybeSingle();
  const datos = (fila?.datos ?? {}) as Record<string, unknown>;
  const ultimaSync = typeof datos.ventas_ultima_sync === "string" ? datos.ventas_ultima_sync : null;

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
