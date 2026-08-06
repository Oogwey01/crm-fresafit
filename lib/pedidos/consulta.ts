/* Lo que comparten la página de Pedidos y el action del histórico: mismas
   columnas y misma ventana, para que un pedido se vea idéntico venga de donde
   venga. Vive aquí y no en actions.ts porque un módulo "use server" solo puede
   exportar funciones async. */

/* Ventana amplia: un pedido pendiente puede ser de hace semanas. */
export const DIAS_VENTANA_PEDIDOS = 120;

/* Solo las columnas que pintan la tabla y el diálogo de envío: con `*` la
   respuesta pesaba 819 KB contra 474 KB, y esos bytes viajan al navegador. */
export const COLUMNAS_PEDIDO =
  "id, fecha, canal, cantidad, estado, num_guia, paqueteria, descripcion," +
  " referencia_externa, envio_direccion, url_rastreo, url_orden," +
  " envio_limite_despacho, envio_despachado_en, envio_id," +
  " producto:products!producto_id(id, nombre, variante)," +
  " cliente:customers!cliente_id(id, nombre)";

/* Estados terminales: lo que ya no da trabajo. Es el complemento de
   ESTADOS_PEDIDO_PENDIENTES (lib/catalogos.ts). */
export const ESTADOS_PEDIDO_TERMINALES = ["entregado", "cancelado"] as const;
