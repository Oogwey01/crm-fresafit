/* ============================================================================
   lib/inventario/stock-log.ts — Ledger de escrituras de stock
   ----------------------------------------------------------------------------
   Registra en `stock_log` cada cambio de stock: qué producto, de qué valor a
   qué valor, por qué canal se escribió y qué lo originó. Es diagnóstico: nunca
   debe romper el flujo de negocio, así que un fallo solo se loggea en consola.
   Usa el service role (los webhooks/cron no traen sesión).
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";

/* Dónde impactó la escritura. */
export type CanalStock = "crm" | "tienda_nube" | "mercado_libre" | "tiktok_shop";

export type EntradaStockLog = {
  producto_id: string | null;
  canal: CanalStock;
  origen: string; // manual | tiendanube_sync | mercadolibre_sync | proveedor | ...
  stock_anterior: number | null; // null cuando no se conoce (p. ej. empuje saliente)
  stock_nuevo: number;
};

export async function registrarStockLog(entradas: EntradaStockLog[]): Promise<void> {
  if (entradas.length === 0) return;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("stock_log").insert(entradas);
    if (error) console.error("[stock-log]", error.message);
  } catch (e) {
    console.error("[stock-log]", e);
  }
}
