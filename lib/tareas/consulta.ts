/* Lo que comparten los dos tableros (Fresafit y Agencia), el detalle y el
   respaldo. Vive aquí y no en actions.ts porque un módulo "use server" solo
   puede exportar funciones async (mismo motivo que lib/pedidos/consulta.ts). */

/* Columnas de la tarea, en vez de un `*`. Son las mismas de hoy, escritas a
   mano: `tasks` es la tabla más ancha de la app y se pide DOS veces por carga
   de tablero (abiertas + papelera), así que una columna nueva y pesada se
   pagaría cuatro veces sin que nadie lo hubiera pedido.

   `descripcion` sí viaja: el detalle se abre desde la tarjeta sin volver a
   consultar, y quitarla obligaría a un viaje extra por cada tarea que se abre. */
export const COLUMNAS_TAREA =
  "id, titulo, descripcion, responsable_id, espacio, empresa_id, visibilidad," +
  " categoria, area, prioridad," +
  " estado, fecha_limite, fecha_inicio, motivo_atorado, etiquetas, orden," +
  " recordatorio_at, recordatorio_enviado, deleted_at, ultima_actividad_at," +
  " created_by, created_at, updated_at";

/* Con el responsable ya resuelto: lo que piden los tableros y el detalle. */
export const COLUMNAS_TAREA_CON_RESPONSABLE =
  `${COLUMNAS_TAREA}, responsable:profiles!responsable_id(id, nombre, color)` as const;

/* Cuántas borradas trae la papelera. Viajaba COMPLETA en cada carga del
   tablero y crece para siempre: se entra a recuperar algo que se borró hace
   poco, no a hacer arqueología. */
export const LIMITE_PAPELERA = 100;
