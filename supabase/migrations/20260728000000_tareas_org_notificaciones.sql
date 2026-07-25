-- ============================================================================
-- Fresafit CRM — Migración: organización de Tareas + notificaciones
-- ----------------------------------------------------------------------------
-- Cierra las brechas de la spec "Tareas Fresa" sobre el módulo ya existente:
--   * Papelera        → tasks.deleted_at (borrado suave; null = activa).
--   * Recordatorios   → tasks.recordatorio_at / recordatorio_enviado (el cron
--                       /api/tareas/recordatorios genera el aviso).
--   * Avisos in-app   → tabla `notifications` + trigger que avisa al responsable
--                       cuando se le ASIGNA (o reasigna) una tarea (B.4).
-- No toca `fecha_limite` (sigue siendo solo fecha). Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas nuevas en tasks
-- ---------------------------------------------------------------------------
alter table public.tasks add column if not exists deleted_at           timestamptz;
alter table public.tasks add column if not exists recordatorio_at      timestamptz;
alter table public.tasks add column if not exists recordatorio_enviado boolean not null default false;

-- El cron busca por aquí: solo recordatorios pendientes de enviar.
create index if not exists tasks_recordatorio_idx
  on public.tasks (recordatorio_at)
  where recordatorio_at is not null and not recordatorio_enviado;

-- ---------------------------------------------------------------------------
-- 2. Notificaciones al usuario (feed de la campana)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,  -- destinatario
  task_id    uuid references public.tasks(id) on delete cascade,
  tipo       text not null default 'asignacion' check (tipo in ('asignacion','recordatorio')),
  texto      text not null,
  leida      boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on public.notifications (user_id, leida, created_at desc);

grant all on public.notifications to anon, authenticated;

alter table public.notifications enable row level security;

-- Cada quien ve y marca leídas SOLO las suyas. El insert lo hacen el trigger
-- (SECURITY DEFINER) y el cron (service_role); no hace falta policy de insert.
drop policy if exists "notis: ver propias" on public.notifications;
create policy "notis: ver propias" on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "notis: marcar propias" on public.notifications;
create policy "notis: marcar propias" on public.notifications
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Trigger: avisar al responsable cuando se le asigna una tarea
--    (alta con responsable, o reasignación). No se auto-avisa quien se asigna
--    a sí mismo, ni se avisa por tareas que nacen o quedan en la papelera.
-- ---------------------------------------------------------------------------
create or replace function public.notificar_asignacion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.responsable_id is null or new.deleted_at is not null then
    return new;
  end if;
  -- Solo si el responsable CAMBIÓ y no es la propia persona que hace el cambio.
  if new.responsable_id is distinct from
       (case when tg_op = 'UPDATE' then old.responsable_id else null end)
     and new.responsable_id is distinct from auth.uid()
  then
    insert into public.notifications (user_id, task_id, tipo, texto)
      values (new.responsable_id, new.id, 'asignacion',
              'Te asignaron: ' || new.titulo);
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_notificar_asignacion on public.tasks;
create trigger tasks_notificar_asignacion
  after insert or update of responsable_id on public.tasks
  for each row execute function public.notificar_asignacion();

-- ---------------------------------------------------------------------------
-- 4. Re-armar el recordatorio: si cambia `recordatorio_at`, vuelve a "no
--    enviado" para que el cron lo dispare de nuevo (corre antes del update).
-- ---------------------------------------------------------------------------
create or replace function public.rearmar_recordatorio()
returns trigger language plpgsql as $$
begin
  if new.recordatorio_at is distinct from old.recordatorio_at then
    new.recordatorio_enviado := false;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_rearmar_recordatorio on public.tasks;
create trigger tasks_rearmar_recordatorio
  before update of recordatorio_at on public.tasks
  for each row execute function public.rearmar_recordatorio();

notify pgrst, 'reload schema';
