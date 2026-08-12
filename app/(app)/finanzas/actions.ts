/* Barril de las acciones de Finanzas. Dos familias con guardias DISTINTAS: los
   gastos del negocio (con sus comprobantes) son administrativos, y los pagos
   fijos personales son de quien los capturó —otra tabla, otra RLS—. Por eso
   están partidas y no en un archivo solo.

   NO lleva "use server": las acciones ya vienen marcadas desde su archivo de
   origen, y un módulo de acciones no admite `export *` (Turbopack). */

export * from "@/app/(app)/finanzas/acciones/gastos";
export * from "@/app/(app)/finanzas/acciones/personales";
