/* Lo que comparten la página de Finanzas y sus actions. Vive aquí y no en
   actions.ts porque un módulo "use server" solo puede exportar funciones async
   (mismo motivo que lib/pedidos/consulta.ts). */

/* Columnas del gasto, en vez de un `*`. Son las mismas de hoy, escritas a
   mano: con `*` cualquier columna nueva y pesada que se le agregue a
   `expenses` —o a `expense_receipts` a través del embed— viajaría al navegador
   sin que nadie lo pidiera. `storage_path` sí va: es lo que la vista usa para
   firmar la descarga del comprobante. */
export const COLUMNAS_GASTO =
  "id, fecha, concepto, monto, categoria, proveedor, notas, metodo_pago," +
  " factura, recibo, clave, created_by, created_at, updated_at," +
  " comprobantes:expense_receipts(id, expense_id, nombre, storage_path, tipo, created_at)";
