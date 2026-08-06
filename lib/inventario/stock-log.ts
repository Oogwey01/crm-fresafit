/* ============================================================================
   lib/inventario/stock-log.ts — Ledger de escrituras de stock
   ----------------------------------------------------------------------------
   Registra en `stock_log` cada cambio de stock: qué producto, de qué valor a
   qué valor, por qué canal se escribió y qué lo originó. Es diagnóstico: nunca
   debe romper el flujo de negocio, así que un fallo solo se loggea en consola.
   Usa el service role (los webhooks/cron no traen sesión); el «quién» no sale
   del cliente por eso mismo, sino del contexto de actor (ver `actor.ts`).
   ============================================================================ */

import { actorActual } from "@/lib/inventario/actor";
import { createAdminClient } from "@/lib/supabase/admin";

/* Dónde impactó la escritura. */
export type CanalStock = "crm" | "tienda_nube" | "mercado_libre" | "tiktok_shop";

export type EntradaStockLog = {
  producto_id: string | null;
  canal: CanalStock;
  origen: string; // manual | tiendanube_sync | mercadolibre_sync | proveedor | ...
  stock_anterior: number | null; // null cuando no se conoce
  stock_nuevo: number;
  /* true = el hub decidió esta escritura pero NO la aplicó (modo simulacro).
     Sirve para medir si acierta antes de darle permiso de escribir de verdad. */
  simulado?: boolean;
  /* Id de la operación que agrupa este renglón con los demás que se escribieron
     en la misma llamada. Casi nunca se pasa: lo asigna `registrarStockLog`. */
  lote?: string;
  /* Quién lo provocó. Casi nunca se pasa: lo toma del contexto de actor. */
  created_by?: string | null;
};

export async function registrarStockLog(entradas: EntradaStockLog[]): Promise<void> {
  if (entradas.length === 0) return;
  try {
    const admin = createAdminClient();
    // Un id de lote por llamada. Una operación (una corrida de sync, una
    // recepción) inserta todos sus renglones de golpe con el mismo `creado_en`
    // —`now()` es constante dentro de la transacción—, así que sin esto el
    // historial los muestra como N cambios sueltos a la misma hora. Con el lote,
    // la pantalla los junta en un bloque. Las entradas que ya traen `lote` lo
    // conservan (por si algún flujo quiere agrupar entre varias llamadas).
    const lote = crypto.randomUUID();
    // El actor viaja por contexto, no por parámetro: queda NULL en lo que corre
    // sin nadie detrás (cron, webhook de venta), que es lo que hay que guardar.
    const autor = actorActual();
    const filas = entradas.map((e) => ({
      ...e,
      lote: e.lote ?? lote,
      created_by: e.created_by ?? autor,
    }));
    const { error } = await admin.from("stock_log").insert(filas);
    if (error) console.error("[stock-log]", error.message);
  } catch (e) {
    console.error("[stock-log]", e);
  }
}
