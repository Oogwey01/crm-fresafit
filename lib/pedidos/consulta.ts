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
  " envio_subestado, envio_logistica," +
  " etapa_empaque, etapa_empaque_en," +
  " rastreo_estado, rastreo_detalle, rastreo_en," +
  /* `imagen_url` es la foto que el tablero de empaque pinta de fondo en cada
     tarjeta: al armar la caja se reconoce antes el producto por la foto que por
     el nombre, sobre todo entre variantes que solo se diferencian en el color. */
  " producto:products!producto_id(id, nombre, variante, imagen_url)," +
  " cliente:customers!cliente_id(id, nombre)";

/* Estados terminales: lo que ya no da trabajo. Es el complemento de
   ESTADOS_PEDIDO_PENDIENTES (lib/catalogos.ts). `devuelto` entra aquí porque el
   viaje del paquete terminó —mal, pero terminó—: lo que sigue es un reembolso o
   un reenvío, no despacharlo otra vez. Se ve en el histórico y filtrando por su
   estado. */
export const ESTADOS_PEDIDO_TERMINALES = ["entregado", "devuelto", "cancelado"] as const;
