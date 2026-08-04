-- ============================================================================
-- 20260806000000_tareas_comentarios_novedades.sql — Avisos de comentario y
-- marca de "hay algo nuevo" en las tareas
-- ----------------------------------------------------------------------------
-- De la revisión de Armando sobre el módulo de Tareas:
--   * "cuando pongo un comentario, que el comentario también le marque una
--     notificación" → ya había trigger de asignación y de atorado, pero NINGUNO
--     para comentarios: se comentaba y el otro no se enteraba.
--   * "que cuando vea la tarea desde fuera salga que hay un comentario, que hay
--     algo nuevo, y la última actualización" → hacía falta saber (a) cuándo se
--     movió la tarea por última vez y (b) si esa novedad es nueva PARA MÍ.
--   * "incluso hasta pueda filtrar por últimos comentarios sus tareas" → con
--     `ultima_actividad_at` indexada, ordenar por actividad es directo.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Cuándo se movió la tarea por última vez
-- ----------------------------------------------------------------------------
-- No sirve `updated_at`: sólo cambia al editar la fila de `tasks`, y un
-- comentario nuevo no la toca. Esta columna incluye la actividad satélite.
-- ---------------------------------------------------------------------------
alter table public.tasks add column if not exists ultima_actividad_at timestamptz;

-- Semilla para las tareas que ya existen: lo más reciente que se sepa de ellas.
update public.tasks t
   set ultima_actividad_at = greatest(
         coalesce(t.updated_at, t.created_at),
         coalesce((select max(c.created_at) from public.task_comments c where c.task_id = t.id),
                  t.created_at),
         coalesce((select max(a.created_at) from public.task_activity a where a.task_id = t.id),
                  t.created_at)
       )
 where t.ultima_actividad_at is null;

alter table public.tasks alter column ultima_actividad_at set default now();

-- Orden por actividad reciente ("¿qué se movió hoy?") sin escanear la tabla.
create index if not exists tasks_ultima_actividad_idx
  on public.tasks (ultima_actividad_at desc)
  where deleted_at is null;

-- Cualquier escritura en la tarea cuenta como actividad.
create or replace function public.tocar_actividad_tarea()
returns trigger language plpgsql as $$
begin
  new.ultima_actividad_at := now();
  return new;
end;
$$;

drop trigger if exists tasks_tocar_actividad on public.tasks;
create trigger tasks_tocar_actividad
  before update on public.tasks
  for each row execute function public.tocar_actividad_tarea();

-- Los comentarios y el historial viven en tablas satélite: al insertar en ellas
-- hay que subir la marca de la tarea a mano.
create or replace function public.tocar_actividad_desde_satelite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.tasks set ultima_actividad_at = now() where id = new.task_id;
  return new;
end;
$$;

drop trigger if exists task_comments_tocar_actividad on public.task_comments;
create trigger task_comments_tocar_actividad
  after insert on public.task_comments
  for each row execute function public.tocar_actividad_desde_satelite();

drop trigger if exists task_activity_tocar_actividad on public.task_activity;
create trigger task_activity_tocar_actividad
  after insert on public.task_activity
  for each row execute function public.tocar_actividad_desde_satelite();

-- ---------------------------------------------------------------------------
-- 2) ¿Esa novedad es nueva PARA MÍ?
-- ----------------------------------------------------------------------------
-- `ultima_actividad_at` es global a la tarea; el punto de "no leído" es por
-- persona. Una fila por (tarea, usuario) con cuándo la vio por última vez.
-- ---------------------------------------------------------------------------
create table if not exists public.task_reads (
  task_id  uuid not null references public.tasks(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  leido_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index if not exists task_reads_user_idx on public.task_reads (user_id);

grant all on public.task_reads to authenticated, service_role;
alter table public.task_reads enable row level security;

-- Cada quien lleva su propia marca de lectura, y solo sobre tareas que puede ver.
drop policy if exists "lecturas: ver propias" on public.task_reads;
create policy "lecturas: ver propias" on public.task_reads
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "lecturas: marcar propias" on public.task_reads;
create policy "lecturas: marcar propias" on public.task_reads
  for insert to authenticated
  with check (user_id = auth.uid() and public.puede_ver_tarea(task_id));

drop policy if exists "lecturas: actualizar propias" on public.task_reads;
create policy "lecturas: actualizar propias" on public.task_reads
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3) Aviso cuando alguien comenta
-- ----------------------------------------------------------------------------
-- Se avisa a quien tiene algo que ver con la tarea: el responsable, quien la
-- delegó y quien ya haya comentado antes (el hilo es de todos ellos). Nunca al
-- autor del comentario, que ya sabe lo que escribió.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_tipo_check;
alter table public.notifications
  add constraint notifications_tipo_check
  check (tipo in ('asignacion','recordatorio','atorado','comentario'));

create or replace function public.notificar_comentario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_titulo      text;
  v_responsable uuid;
  v_creador     uuid;
  v_borrada     timestamptz;
  v_quien       text;
  v_resumen     text;
begin
  select titulo, responsable_id, created_by, deleted_at
    into v_titulo, v_responsable, v_creador, v_borrada
    from public.tasks where id = new.task_id;

  if not found or v_borrada is not null then
    return new;
  end if;

  select nombre into v_quien from public.profiles where id = new.autor;
  v_quien := coalesce(v_quien, 'Alguien');

  -- Un extracto basta para el feed; el texto completo está en la tarea.
  v_resumen := v_quien || ' comentó en «' || v_titulo || '»: ' ||
               left(regexp_replace(new.texto, '\s+', ' ', 'g'), 90) ||
               case when length(new.texto) > 90 then '…' else '' end;

  insert into public.notifications (user_id, task_id, tipo, texto)
  select d.user_id, new.task_id, 'comentario', v_resumen
    from (
      select v_responsable as user_id
      union
      select v_creador
      union
      -- Quien ya participó en el hilo quiere seguir enterándose.
      select c.autor from public.task_comments c where c.task_id = new.task_id
    ) d
   where d.user_id is not null
     and d.user_id is distinct from new.autor;

  return new;
end;
$$;

drop trigger if exists task_comments_notificar on public.task_comments;
create trigger task_comments_notificar
  after insert on public.task_comments
  for each row execute function public.notificar_comentario();

notify pgrst, 'reload schema';
