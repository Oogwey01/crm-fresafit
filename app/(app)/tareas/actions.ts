/* Barril de las acciones de Tareas. El archivo tenía 858 líneas con nueve
   familias —tareas, detalle, comentarios, subtareas, enlaces, adjuntos,
   respaldo, notificaciones y compartir— y cada una vive ahora bajo
   `acciones/`; lo que comparten está en `acciones/comun.ts`.

   Se queda aquí para no tocar los imports de los componentes del módulo. NO
   lleva "use server": las acciones ya vienen marcadas desde su archivo de
   origen, y un módulo de acciones no admite `export *`. */

export type { TaskInput } from "@/app/(app)/tareas/acciones/comun";
export * from "@/app/(app)/tareas/acciones/tareas";
export * from "@/app/(app)/tareas/acciones/detalle";
export * from "@/app/(app)/tareas/acciones/adjuntos";
export * from "@/app/(app)/tareas/acciones/respaldo";
export * from "@/app/(app)/tareas/acciones/notificaciones";
