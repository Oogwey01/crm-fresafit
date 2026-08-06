/* ============================================================================
   lib/tareas/reglas.ts — Quién trabaja una tarea y quién manda sobre ella
   ----------------------------------------------------------------------------
   Funciones puras que responden las preguntas que se hacen las cinco vistas del
   módulo: ¿quién la trabaja?, ¿es mía?, ¿la puedo editar?, ¿tiene algo nuevo
   para mí? Vivían en lib/types.ts, que es un archivo de TIPOS: comportamiento
   mezclado con vocabulario. Se usan igual en servidor y en navegador, así que
   no tocan Supabase ni leen sesión — reciben lo que necesitan por parámetro.
   ============================================================================ */

import { esGestor } from "@/lib/catalogos";
import type { Profile, TaskAttachment, TaskConResponsable } from "@/lib/types";

/* Todas las personas que trabajan una tarea: la principal primero y luego los
   coasignados. Es lo que se pinta en las tarjetas y lo que decide si la tarea
   es "mía". Devuelve lista vacía si no hay nadie asignado. */
export function equipoDeTarea(
  t: Pick<TaskConResponsable, "responsable" | "coasignados">,
): Pick<Profile, "id" | "nombre" | "color">[] {
  const equipo = t.responsable ? [t.responsable] : [];
  for (const c of t.coasignados ?? []) {
    if (c && c.id !== t.responsable?.id) equipo.push(c);
  }
  return equipo;
}

/* ¿Esta persona trabaja la tarea? (principal o coasignada). */
export function trabajaLaTarea(
  t: Pick<TaskConResponsable, "responsable_id" | "coasignados">,
  userId: string | null,
): boolean {
  if (!userId) return false;
  return t.responsable_id === userId || (t.coasignados ?? []).some((c) => c.id === userId);
}

/* ¿Manda sobre ESTA tarea? Un gestor manda en todo el tablero; quien la creó,
   sobre la suya. Desde que cualquiera del equipo puede abrir tareas, el dueño de
   un pendiente propio tiene que poder corregirlo y borrarlo sin perseguir a un
   coordinador. Espejo de lo que aplica la BD (policy "tareas: editar" + trigger
   `restringir_update_tarea`). */
export function mandaEnLaTarea(
  t: Pick<TaskConResponsable, "created_by">,
  rol: string | null | undefined,
  userId: string | null,
): boolean {
  return esGestor(rol) || (!!userId && t.created_by === userId);
}

/* ¿Esta tarea tiene novedades para mí? Sin marca de lectura, se considera vista:
   así las tareas viejas no aparecen todas con punto el primer día. */
export function tieneNovedades(t: Pick<TaskConResponsable, "ultima_actividad_at" | "leido_at">): boolean {
  if (!t.ultima_actividad_at || !t.leido_at) return false;
  return t.ultima_actividad_at > t.leido_at;
}


/* ¿Este adjunto es una foto? Se mira el mime que mandó el navegador y, si no
   llegó —los adjuntos viejos se guardaron sin él y algunos navegadores no lo
   mandan—, la extensión del nombre. De esto depende que en la tarea se vea la
   imagen o solo su nombre en un renglón. */
const EXTENSIONES_IMAGEN = /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|svg)$/i;
export function esImagenAdjunto(a: Pick<TaskAttachment, "tipo" | "nombre">): boolean {
  return a.tipo?.startsWith("image/") || EXTENSIONES_IMAGEN.test(a.nombre ?? "");
}

