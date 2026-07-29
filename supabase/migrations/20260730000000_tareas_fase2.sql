-- ============================================================================
-- 20260730000000_tareas_fase2.sql — Tareas Fase 2 (junta)
-- ----------------------------------------------------------------------------
-- Cambios sobre el módulo de Tareas pedidos en la junta:
--   * Estado nuevo "atorado" + motivo (tasks.motivo_atorado): bloqueada porque
--     se necesita algo de vuelta de quien delegó.
--   * Aviso a quien DELEGÓ (created_by) cuando la tarea pasa a "atorado".
--   * Fecha de inicio (tasks.fecha_inicio, por defecto hoy).
--   * Visibilidad: los miembros ven SOLO sus tareas (asignadas o creadas); antes
--     veían toda su área. Dirección/coordinación siguen viendo todo.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Estado "atorado" + motivo
-- ---------------------------------------------------------------------------
alter table public.tasks drop constraint if exists tasks_estado_check;
alter table public.tasks
  add constraint tasks_estado_check
  check (estado in ('por_hacer','en_proceso','atorado','en_revision','hecho'));

alter table public.tasks add column if not exists motivo_atorado text;

-- Etiqueta legible del estado (la usa el historial de actividad): incluir atorado.
create or replace function public.etiqueta_estado(e text)
returns text language sql immutable as $$
  select case e
    when 'por_hacer'   then 'Por hacer'
    when 'en_proceso'  then 'En proceso'
    when 'atorado'     then 'Atorado'
    when 'en_revision' then 'En revisión'
    when 'hecho'       then 'Hecho'
    else e end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Fecha de inicio (por defecto hoy). Las existentes toman su fecha de alta.
-- ---------------------------------------------------------------------------
alter table public.tasks add column if not exists fecha_inicio date default current_date;
update public.tasks set fecha_inicio = created_at::date where fecha_inicio is null;

-- ---------------------------------------------------------------------------
-- 3) Notificaciones: nuevo tipo "atorado" + aviso a quien delegó.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_tipo_check;
alter table public.notifications
  add constraint notifications_tipo_check
  check (tipo in ('asignacion','recordatorio','atorado'));

-- Cuando una tarea PASA a "atorado", avisar a quien la delegó (created_by),
-- salvo que sea la misma persona que la atora. Corre después del cambio de
-- estado, así que ya ve el motivo capturado en el mismo update.
create or replace function public.notificar_atorado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'atorado'
     and old.estado is distinct from 'atorado'
     and new.deleted_at is null
     and new.created_by is not null
     and new.created_by is distinct from auth.uid()
  then
    insert into public.notifications (user_id, task_id, tipo, texto)
      values (new.created_by, new.id, 'atorado',
              'Atorada: ' || new.titulo ||
              coalesce(' — ' || nullif(new.motivo_atorado, ''), ''));
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_notificar_atorado on public.tasks;
create trigger tasks_notificar_atorado
  after update of estado on public.tasks
  for each row execute function public.notificar_atorado();

-- ---------------------------------------------------------------------------
-- 4) Visibilidad: miembro ve SOLO sus tareas (asignadas o creadas) + compartidas.
--    (Antes: también toda su área.) Gestor sigue viendo todo.
-- ---------------------------------------------------------------------------
create or replace function public.puede_ver_tarea(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.es_gestor()
    or exists (
      select 1 from public.tasks t
      where t.id = tid
        and ( t.responsable_id = auth.uid() or t.created_by = auth.uid() )
    )
    or exists (
      select 1 from public.task_shares s
      where s.task_id = tid and s.user_id = auth.uid()
    );
$$;

notify pgrst, 'reload schema';
