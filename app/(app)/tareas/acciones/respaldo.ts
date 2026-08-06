"use server";

/* Acciones de respaldo e importación en lote (Tareas). Ver el barril en ../actions.ts. */

import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { traerTodo } from "@/lib/canales/paginacion";
import { esGestor } from "@/lib/catalogos";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import {
  empresaParaEspacio,
  revalidarTareas,
  type TaskInput,
} from "@/app/(app)/tareas/acciones/comun";

/* ============================ Respaldo completo =========================== */

/* Trae TODO el módulo de tareas (tareas + comentarios + subtareas + enlaces +
   metadatos de adjuntos + historial + quién trabaja y con quién se compartió)
   para descargarlo como respaldo .json.
   Solo gestores: es la copia de seguridad de todo el equipo, no la vista propia.
   Los archivos binarios de Storage NO se incluyen (solo sus rutas).

   TODAS las tablas se traen paginadas con `traerTodo`. Antes iban con un
   `select` a secas, que parecía traerlo todo pero no: PostgREST corta en 1000
   filas SIN devolver error, así que el archivo que el equipo se descargaba
   creyendo que era su copia de seguridad venía mutilado —comentarios y bitácora
   pasaron de mil hace tiempo— y nada en pantalla lo delataba. Un respaldo que
   miente es peor que no tener respaldo, porque nadie va a buscar el original.

   `task_assignees` y `task_shares` se agregaron por lo mismo: quién más trabaja
   la tarea y con quién se compartió solo viven ahí, y sin ellas el respaldo no
   alcanzaba para reconstruir el módulo. `task_reads` se deja fuera a propósito:
   es la marca de "ya lo vi" de cada persona, se regenera sola con el uso y
   restaurarla no devuelve nada de trabajo perdido. */
export async function exportarRespaldo(): Promise<
  { datos: Record<string, unknown> } | { error: string }
> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  if (!esGestor(rol)) return { error: "Solo dirección o coordinación puede descargar el respaldo completo." };

  type Fila = Record<string, unknown>;
  try {
    /* El orden lleva `id` de desempate a propósito: paginar por rangos exige un
       criterio ÚNICO, y `created_at` no lo es (una importación en lote guarda
       decenas de filas con el mismo instante). Sin el desempate, dos tandas
       podían repetir una fila y saltarse otra. */
    /* Aquí el `*` es a propósito y NO hay que cambiarlo por COLUMNAS_TAREA:
       esto es la copia de seguridad, y tiene que llevarse cualquier columna
       que se agregue en el futuro sin que nadie se acuerde de venir a
       apuntarla. Es justo lo contrario del criterio de las pantallas. */
    const [tareas, perfiles, comentarios, checklist, enlaces, adjuntos, actividad, equipoTarea, compartidas] =
      await Promise.all([
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("tasks").select("*").order("created_at").order("id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("profiles").select("id, nombre, rol, area").order("id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_comments").select("*").order("created_at").order("id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_checklist").select("*").order("created_at").order("id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_links").select("*").order("created_at").order("id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_attachments").select("*").order("created_at").order("id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_activity").select("*").order("created_at").order("id").range(desde, hasta),
        ),
        /* Tablas puente: no tienen `id`, su llave es el par (tarea, persona). */
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_assignees").select("*").order("task_id").order("user_id").range(desde, hasta),
        ),
        traerTodo<Fila>((desde, hasta) =>
          supabase.from("task_shares").select("*").order("task_id").order("user_id").range(desde, hasta),
        ),
      ]);

    return {
      datos: {
        exportadoEl: new Date().toISOString(),
        /* La nota dice exactamente qué hay y qué no: es el papelito que va a
           leer quien abra este archivo dentro de un año para saber si le sirve. */
        nota:
          "Respaldo completo del módulo Tareas: tareas (incluidas las de la papelera)," +
          " comentarios, subtareas, enlaces, historial, el equipo de cada tarea y con quién" +
          " se compartió. Todas las tablas van íntegras, sin recorte. No incluye los archivos" +
          " adjuntos —solo sus rutas en Storage— ni las marcas de 'ya lo vi' de cada persona," +
          " que se regeneran solas con el uso.",
        equipo: perfiles,
        tareas,
        comentarios,
        subtareas: checklist,
        enlaces,
        adjuntos,
        actividad,
        coasignados: equipoTarea,
        compartidas,
      },
    };
  } catch (e) {
    /* `traerTodo` lanza en cuanto una tanda falla, y hace bien: mejor no
       entregar respaldo que entregar uno a medias sin decirlo. */
    return { error: e instanceof Error ? e.message : "No se pudo armar el respaldo." };
  }
}

/* ============================ Importar en lote ============================= */

/* Alta masiva de tareas (pegar texto → filas). Solo gestor. Reusa el insert de
   `crearTarea`; cada fila con responsable dispara el aviso vía trigger. */
export async function importarTareas(
  filas: TaskInput[],
): Promise<{ ok: true; creadas: number } | { error: string }> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede importar tareas.");
  if ("error" in cx) return cx;

  const validas = filas
    .map((f) => ({ ...f, titulo: f.titulo.trim() }))
    .filter((f) => f.titulo);
  if (!validas.length) return { error: "No hay renglones con título para importar." };

  const { error } = await cx.supabase.from("tasks").insert(
    validas.map((f) => ({
      titulo: f.titulo,
      descripcion: textoONulo(f.descripcion),
      responsable_id: f.responsable_id,
      espacio: f.espacio ?? "fresafit",
      empresa_id: empresaParaEspacio(f.espacio ?? "fresafit", f.empresa_id),
      area: f.area,
      prioridad: f.prioridad,
      estado: f.estado,
      fecha_limite: f.fecha_limite || null,
      recordatorio_at: f.recordatorio_at || null,
      etiquetas: f.etiquetas ?? [],
      created_by: cx.user.id,
    })),
  );
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true, creadas: validas.length };
}
