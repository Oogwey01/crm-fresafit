"use server";

/* Acciones de las tareas mismas (Tareas). Ver el barril en ../actions.ts. */

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import type {
  AreaId,
  EstadoId,
  PrioridadId,
} from "@/lib/types";
import {
  areaDeResponsable,
  categoriaParaEspacio,
  empresaParaEspacio,
  empujarAvisos,
  exigirMandoTarea,
  motivoParaEstado,
  registrarActividad,
  revalidarTareas,
  sincronizarCoasignados,
  validarCierre,
  visibilidadParaEspacio,
  type TaskInput,
} from "@/app/(app)/tareas/acciones/comun";

/* ============================ Tareas ====================================== */

/* Crear tarea: TODO el equipo de casa, no solo quien coordina. Un miembro abre
   sus propios pendientes —que antes vivían en una libreta— y puede asignárselos
   a quien toque; el aviso al responsable lo dispara `notificar_asignacion`.
   `externo` queda fuera: ese rol solo ve lo que se le comparte.

   OJO con el `.select("id")` de aquí abajo: hace que el alta sea un
   INSERT … RETURNING, y en una tabla con RLS eso pasa TAMBIÉN por la política
   de lectura, aplicada a la fila recién nacida. Si esa política sale a buscar
   la fila en vez de mirar sus columnas, no la encuentra —no está en el
   snapshot de la sentencia— y el alta falla con un error que parece de
   permisos de escritura. Ya pasó una vez; lo cuenta entero
   20260907000000_ver_tareas_por_columna.sql. El id se necesita para sumar a los
   acompañantes, así que el RETURNING se queda. */
export async function crearTarea(input: TaskInput): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo de Fresafit puede crear tareas.");
  if ("error" in cx) return cx;

  const titulo = input.titulo.trim();
  if (!titulo) return { error: "La tarea necesita un título." };

  const espacio = input.espacio ?? "fresafit";
  const empresa = empresaParaEspacio(espacio, input.empresa_id);

  const { data, error } = await cx.supabase
    .from("tasks")
    .insert({
      titulo,
      descripcion: textoONulo(input.descripcion),
      responsable_id: input.responsable_id,
      espacio,
      empresa_id: empresa,
      visibilidad: visibilidadParaEspacio(espacio, empresa, input.visibilidad),
      categoria: categoriaParaEspacio(espacio, input.categoria),
      area: await areaDeResponsable(cx.supabase, input.responsable_id, input.area),
      prioridad: input.prioridad,
      estado: input.estado,
      fecha_limite: input.fecha_limite || null,
      recordatorio_at: input.recordatorio_at || null,
      motivo_atorado: motivoParaEstado(input.estado, input.motivo_atorado),
      etiquetas: input.etiquetas ?? [],
      created_by: cx.user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  const falloEquipo = await sincronizarCoasignados(
    cx.supabase,
    data.id,
    input.coasignados,
    input.responsable_id,
  );
  if (falloEquipo) return { error: `La tarea se creó, pero no se pudo sumar al equipo: ${falloEquipo}` };

  revalidarTareas();
  empujarAvisos();
  return { ok: true };
}

export async function editarTarea(id: string, input: TaskInput): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede editar sus datos.",
  );
  if ("error" in cx) return cx;

  const titulo = input.titulo.trim();
  if (!titulo) return { error: "La tarea necesita un título." };

  /* El espacio NO se edita: una tarea nace en el tablero donde se creó. El
     cliente sí, y solo se toca si el formulario lo mandó (el de Fresafit no lo
     tiene y no debe borrar el que ya trae la tarea). Con él viajan la
     visibilidad y la categoría, que son del mismo acuerdo y solo existen ahí. */
  const cliente =
    input.espacio === "agencia" && input.empresa_id !== undefined
      ? {
          empresa_id: input.empresa_id || null,
          /* Solo se tocan si el formulario las mandó: un formulario viejo (o el
             de estado rápido) que no las conoce NO debe regresar a `interno`
             una tarea ya compartida. `undefined` = no opinar. */
          ...(input.visibilidad !== undefined
            ? {
                visibilidad: visibilidadParaEspacio(
                  "agencia",
                  input.empresa_id || null,
                  input.visibilidad,
                ),
              }
            : {}),
          ...(input.categoria !== undefined
            ? { categoria: categoriaParaEspacio("agencia", input.categoria) }
            : {}),
        }
      : {};

  /* Cerrar una tarea de ciertas categorías exige la prueba (el documento, o al
     menos una línea que diga cómo quedó). Se comprueba antes de escribir para
     poder decirlo con palabras; si no se está cerrando nada, ni se consulta. */
  const falta = await validarCierre(cx.supabase, id, input.estado);
  if (falta) return { error: falta };

  const { error } = await cx.supabase
    .from("tasks")
    .update({
      titulo,
      descripcion: textoONulo(input.descripcion),
      responsable_id: input.responsable_id,
      ...cliente,
      area: await areaDeResponsable(cx.supabase, input.responsable_id, input.area),
      prioridad: input.prioridad,
      estado: input.estado,
      fecha_limite: input.fecha_limite || null,
      /* Reprogramarlo lo vuelve a armar solo: el trigger
         `tasks_rearmar_recordatorio` pone `recordatorio_enviado` en false
         cuando la fecha cambia (20260728000000_tareas_org_notificaciones.sql). */
      recordatorio_at: input.recordatorio_at || null,
      motivo_atorado: motivoParaEstado(input.estado, input.motivo_atorado),
      etiquetas: input.etiquetas ?? [],
    })
    .eq("id", id);

  if (error) return { error: error.message };

  const falloEquipo = await sincronizarCoasignados(
    cx.supabase,
    id,
    input.coasignados,
    input.responsable_id,
  );
  if (falloEquipo) return { error: `Se guardó la tarea, pero no el equipo: ${falloEquipo}` };

  revalidarTareas();
  empujarAvisos(); // editar puede cambiar el responsable o sumar gente
  return { ok: true };
}

/* Mover de estado: gestor (cualquiera) o miembro responsable (RLS + trigger lo
   refuerzan). Al pasar a "atorado" se guarda el motivo (qué se necesita de
   vuelta); al salir de "atorado" el motivo se limpia. El aviso a quien delegó lo
   dispara el trigger `notificar_atorado` en la BD. */
export async function moverTarea(
  id: string,
  estado: EstadoId,
  motivoAtorado?: string | null,
): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;

  /* Mismo requisito de cierre que al editar: da igual que la tarea se dé por
     terminada arrastrándola en el tablero o desde su detalle. */
  const falta = await validarCierre(cx.supabase, id, estado);
  if (falta) return { error: falta };

  const { error } = await cx.supabase
    .from("tasks")
    .update({ estado, motivo_atorado: motivoParaEstado(estado, motivoAtorado) })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  empujarAvisos(); // pasar a "atorado" avisa a quien delegó
  return { ok: true };
}

/* Cambiar prioridad rápido desde una celda (gestor o quien creó la tarea). */
export async function cambiarPrioridad(id: string, prioridad: PrioridadId): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede cambiar su prioridad.",
  );
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("tasks").update({ prioridad }).eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true };
}

/* Reasignar responsable (gestor o quien creó la tarea). El aviso al nuevo
   responsable lo dispara el trigger `notificar_asignacion` en la BD, así que
   cubre también el arrastre entre carriles de persona y la edición desde el
   detalle. */
export async function reasignarTarea(id: string, responsableId: string | null): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede reasignarla.",
  );
  if ("error" in cx) return cx;
  /* Al reasignar, el área sigue al nuevo responsable (si tiene perfil con área).
     Sin responsable se conserva el área actual de la tarea. */
  const patch: { responsable_id: string | null; area?: AreaId } = { responsable_id: responsableId };
  if (responsableId) {
    const { data } = await cx.supabase.from("profiles").select("area").eq("id", responsableId).single();
    const area = data?.area as AreaId | null;
    if (area) patch.area = area;
  }
  /* El update de la tarea y la salida del acompañante no dependen entre sí:
     juntos en un solo viaje de pared.

     Lo segundo es porque quien pasa a principal, si venía como acompañante, ya
     está en `responsable_id`: dejarlo en la tabla le repetiría el avatar. */
  const [actualizada] = await Promise.all([
    cx.supabase.from("tasks").update(patch).eq("id", id),
    responsableId
      ? cx.supabase.from("task_assignees").delete().eq("task_id", id).eq("user_id", responsableId)
      : Promise.resolve(null),
  ]);
  if (actualizada.error) return { error: actualizada.error.message };

  revalidarTareas();
  empujarAvisos();
  return { ok: true };
}

/* Mover una tarea de la agencia a otro cliente (arrastre entre carriles del
   tablero por cliente, o el selector del detalle). `null` = trabajo de la propia
   agencia. Solo aplica en el espacio "agencia": la BD rechaza ponerle cliente a
   una tarea de Fresafit, y aquí se avisa con palabras en vez de con un error de
   constraint. */
export async function reasignarEmpresa(
  id: string,
  empresaId: string | null,
): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede cambiarla de cliente.",
  );
  if ("error" in cx) return cx;

  const { data, error: errLeer } = await cx.supabase
    .from("tasks")
    .select("espacio")
    .eq("id", id)
    .single();
  if (errLeer) return { error: errLeer.message };
  if (data.espacio !== "agencia") {
    return { error: "Solo las tareas de la Agencia pertenecen a un cliente." };
  }

  const { error } = await cx.supabase
    .from("tasks")
    .update({ empresa_id: empresaId })
    .eq("id", id);
  if (error) return { error: error.message };

  await registrarActividad(
    cx.supabase,
    id,
    cx.user.id,
    empresaId ? "cambió la tarea de cliente" : "quitó el cliente de la tarea",
  );
  revalidarTareas();
  return { ok: true };
}

/* Cambiar el equipo de apoyo de una tarea sin tocar nada más (el selector de
   personas del detalle). El principal se administra con `reasignarTarea`. */
export async function guardarCoasignados(id: string, userIds: string[]): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede cambiar su equipo.",
  );
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase
    .from("tasks")
    .select("responsable_id")
    .eq("id", id)
    .single();
  if (error) return { error: error.message };

  const fallo = await sincronizarCoasignados(cx.supabase, id, userIds, data.responsable_id);
  if (fallo) return { error: fallo };

  revalidarTareas();
  empujarAvisos();
  return { ok: true };
}

/* Borrado SUAVE: manda la tarea a la papelera (se puede restaurar).
   Gestor o quien la creó: lo que uno abre por error, uno lo puede tirar. */
export async function borrarTarea(id: string): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede borrarla.",
  );
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true };
}

/* Sacar de la papelera. */
export async function restaurarTarea(id: string): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede restaurarla.",
  );
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("tasks").update({ deleted_at: null }).eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true };
}

/* Eliminar DEFINITIVO (borrado real, sin vuelta atrás). */
export async function eliminarDefinitivo(id: string): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede eliminarla.",
  );
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("tasks").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidarTareas();
  return { ok: true };
}

/* Cambiar las etiquetas de una tarea (gestor o quien la creó). */
export async function guardarEtiquetas(id: string, etiquetas: string[]): Promise<Resultado> {
  const cx = await exigirMandoTarea(
    id,
    "Solo dirección, coordinación o quien creó la tarea puede cambiar sus etiquetas.",
  );
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("tasks").update({ etiquetas }).eq("id", id);
  if (error) return { error: error.message };
  await registrarActividad(cx.supabase, id, cx.user.id, "actualizó las etiquetas");
  revalidarTareas();
  return { ok: true };
}
