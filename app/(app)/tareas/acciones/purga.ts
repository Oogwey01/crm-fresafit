"use server";

/* Purga TOTAL del módulo de tareas — «borrar absolutamente todas las tareas
   para empezar de cero», pedido por Armando en la junta del 13/08/2026.

   Es la acción más destructiva del CRM y por eso lleva tres candados:
   1. Solo dirección (exigirRol), y la pantalla además obliga a descargar el
      respaldo completo ANTES de habilitar el botón.
   2. La frase de confirmación viaja hasta aquí y se re-verifica: la UI se puede
      saltar, esta función no.
   3. Corre con el admin client (service role) a propósito: la policy de DELETE
      de `tasks` solo deja borrar lo propio o siendo es_admin, y una purga a
      medias —mis tareas sí, las de los demás no— sería peor que no purgar.

   Orden de las operaciones: PRIMERO los archivos de Storage, DESPUÉS las filas.
   Al revés, el cascade de `task_attachments` borra el registro y los binarios
   quedan huérfanos e invisibles para siempre. Si Storage falla a la mitad, las
   tareas siguen ahí y se puede reintentar (y el respaldo ya está descargado).

   Las 9 tablas satélite (comentarios, checklist, enlaces, actividad, shares,
   attachments, reads, assignees y las notificaciones con task_id) caen solas
   por ON DELETE CASCADE. */

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/canales/paginacion";
import { revalidarTareas } from "@/app/(app)/tareas/acciones/comun";
import { FRASE_PURGA } from "@/lib/tareas/purga";

/* Lotes chicos para `storage.remove`: mandar miles de rutas en una llamada
   revienta el payload y un fallo se llevaría todo el intento. */
const LOTE_STORAGE = 100;

export async function purgarTodasLasTareas(
  confirmacion: string,
  /* false = solo el espacio Fresafit (lo que Armando estaba viendo); true =
     también las tareas de la Agencia. Se elige en el diálogo. */
  incluirAgencia: boolean,
): Promise<Resultado<{ tareas: number; archivos: number }>> {
  const cx = await exigirRol("direccion", "Solo dirección puede vaciar el módulo de tareas.");
  if ("error" in cx) return cx;
  if (confirmacion !== FRASE_PURGA) {
    return { error: `Escribe «${FRASE_PURGA}» tal cual para confirmar.` };
  }

  const admin = createAdminClient();

  /* 1. Las rutas de TODOS los adjuntos afectados (paginado: PostgREST corta en
     1000 sin avisar). Se trae el espacio de la tarea para respetar el corte. */
  type FilaAdjunto = { storage_path: string; tarea: { espacio: string } | null };
  let adjuntos: FilaAdjunto[];
  try {
    adjuntos = await traerTodo<FilaAdjunto>((desde, hasta) =>
      admin
        .from("task_attachments")
        .select("storage_path, tarea:tasks!task_id(espacio)")
        .order("id")
        .range(desde, hasta),
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudieron listar los adjuntos." };
  }

  const rutas = adjuntos
    .filter((a) => incluirAgencia || (a.tarea?.espacio ?? "fresafit") === "fresafit")
    .map((a) => a.storage_path)
    .filter(Boolean);

  /* 2. Borrar los binarios. Si algo truena aquí, NO se toca ninguna tarea. */
  let archivos = 0;
  for (let i = 0; i < rutas.length; i += LOTE_STORAGE) {
    const lote = rutas.slice(i, i + LOTE_STORAGE);
    const { error } = await admin.storage.from("adjuntos").remove(lote);
    if (error) {
      return {
        error: `Se borraron ${archivos} archivos y falló el lote siguiente (${error.message}). Ninguna tarea se tocó: reintenta.`,
      };
    }
    archivos += lote.length;
  }

  /* 3. Las tareas. El cascade arrastra las 9 satélites. */
  const borra = admin.from("tasks").delete();
  const filtrada = incluirAgencia
    ? borra.not("id", "is", null) // delete exige un filtro; éste las cubre todas
    : borra.eq("espacio", "fresafit");
  const { data, error } = await filtrada.select("id");
  if (error) return { error: error.message };

  revalidarTareas();
  return { ok: true, datos: { tareas: data?.length ?? 0, archivos } };
}
