-- ============================================================================
-- 20260817000000_tareas_coasignados.sql — Varias personas por tarea
-- ----------------------------------------------------------------------------
-- Lo pidió Armando en la junta del 03/08/2026: "digamos que yo le quiero poner
-- una tarea que involucre a dos personas… ¿cómo le hago?". Hasta ahora una
-- tarea tenía UN solo `responsable_id`, así que trabajos en equipo (adaptar el
-- estudio = Julio + Manuel; el protocolo del live = Luna + Arge con Julio
-- vigilando) había que duplicarlos o dejarlos en la descripción.
--
-- Modelo: `responsable_id` NO desaparece. Sigue siendo la persona PRINCIPAL —
-- la que da el área a la tarea, la que manda en el carril del tablero y la que
-- se arrastra entre columnas. `task_assignees` agrega a los DEMÁS implicados,
-- que ven la tarea, la mueven, comentan y reciben los avisos igual que el
-- principal. Así ningún flujo actual (drag entre carriles, área que sigue al
-- responsable, permisos) cambia de significado.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tabla puente
-- ---------------------------------------------------------------------------
create table if not exists public.task_assignees (
  task_id    uuid not null references public.tasks(id)    on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists task_assignees_user_idx on public.task_assignees(user_id);

alter table public.task_assignees enable row level security;

-- ---------------------------------------------------------------------------
-- 2) Helper: ¿esta persona trabaja en la tarea? (principal o coasignada)
--    SECURITY DEFINER para leer tasks/task_assignees sin recursión de RLS.
-- ---------------------------------------------------------------------------
create or replace function public.es_asignado_tarea(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tasks t
                  where t.id = tid and t.responsable_id = auth.uid())
      or exists (select 1 from public.task_assignees a
                  where a.task_id = tid and a.user_id = auth.uid());
$$;

grant execute on function public.es_asignado_tarea(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Visibilidad y contribución: los coasignados cuentan como asignados.
--    (Reemplaza la versión de 20260730000000_tareas_fase2.sql.)
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
      select 1 from public.task_assignees a
      where a.task_id = tid and a.user_id = auth.uid()
    )
    or exists (
      select 1 from public.task_shares s
      where s.task_id = tid and s.user_id = auth.uid()
    );
$$;

create or replace function public.puede_contribuir_tarea(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_gestor() or public.es_asignado_tarea(tid);
$$;

-- ---------------------------------------------------------------------------
-- 4) Policies de la tabla puente.
--    Ver: quien ya puede ver la tarea (así el equipo se pinta en la tarjeta).
--    Gestionar: solo gestor, igual que reasignar.
-- ---------------------------------------------------------------------------
drop policy if exists "coasignados: ver" on public.task_assignees;
create policy "coasignados: ver" on public.task_assignees
  for select to authenticated using (public.puede_ver_tarea(task_id));

drop policy if exists "coasignados: gestionar (solo gestor)" on public.task_assignees;
create policy "coasignados: gestionar (solo gestor)" on public.task_assignees
  for all to authenticated
  using (public.es_gestor()) with check (public.es_gestor());

-- ---------------------------------------------------------------------------
-- 5) Editar la tarea: el coasignado puede mover el estado como el principal.
-- ---------------------------------------------------------------------------
drop policy if exists "tareas: editar (gestor o responsable)" on public.tasks;
create policy "tareas: editar (gestor o responsable)" on public.tasks
  for update to authenticated
  using (public.es_gestor() or public.es_asignado_tarea(id))
  with check (public.es_gestor() or public.es_asignado_tarea(id));

-- Un NO-gestor sigue pudiendo cambiar SOLO `estado` (y su motivo), pero ahora
-- también si es coasignado y no únicamente el principal.
--
-- OJO — este trigger nunca llegó a restringir nada: venía marcado `security
-- definer`, y dentro de una función así `current_user` es el DUEÑO de la
-- función (postgres), nunca el rol que hace la petición. Su primera guarda
-- (`current_user in ('service_role','postgres',…)`) se cumplía siempre, así que
-- salía por `return new` en la primera línea y cualquier miembro con acceso a
-- la tarea podía cambiarle título, prioridad, fecha o etiquetas.
--
-- Se quita `security definer` para que `current_user` valga lo que debe
-- ('authenticated' vía PostgREST, 'service_role' en el cron, 'postgres' en el
-- SQL Editor). No hace falta: la función no lee tablas por su cuenta, solo
-- llama a `es_gestor()` y `es_asignado_tarea()`, que sí son security definer.
create or replace function public.restringir_update_tarea()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or public.es_gestor() then
    return new;
  end if;
  if not public.es_asignado_tarea(old.id) then
    raise exception 'Solo quien trabaja la tarea o dirección/coordinación puede modificarla.';
  end if;
  -- Persona asignada: se conservan todas las columnas salvo `estado`.
  new.titulo         := old.titulo;
  new.descripcion    := old.descripcion;
  new.responsable_id := old.responsable_id;
  new.area           := old.area;
  new.prioridad      := old.prioridad;
  new.fecha_limite   := old.fecha_limite;
  new.etiquetas      := old.etiquetas;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Aviso al coasignar (el equivalente de `notificar_asignacion`, que solo
--    mira `tasks.responsable_id` y por tanto no ve esta tabla).
-- ---------------------------------------------------------------------------
create or replace function public.notificar_coasignacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_titulo  text;
  v_borrada timestamptz;
begin
  select titulo, deleted_at into v_titulo, v_borrada
    from public.tasks where id = new.task_id;

  -- Nada que avisar si la tarea no existe, está en la papelera, o la persona
  -- se sumó a sí misma.
  if not found or v_borrada is not null or new.user_id is not distinct from auth.uid() then
    return new;
  end if;

  insert into public.notifications (user_id, task_id, tipo, texto)
    values (new.user_id, new.task_id, 'asignacion',
            'Te sumaron a: ' || v_titulo);
  return new;
end;
$$;

drop trigger if exists task_assignees_notificar on public.task_assignees;
create trigger task_assignees_notificar
  after insert on public.task_assignees
  for each row execute function public.notificar_coasignacion();

-- ---------------------------------------------------------------------------
-- 7) Comentarios: el hilo también es de los coasignados.
--    (Reemplaza la versión de 20260806000000_tareas_comentarios_novedades.sql,
--    agregando el `union` con task_assignees.)
-- ---------------------------------------------------------------------------
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
      -- Todas las personas sumadas a la tarea.
      select a.user_id from public.task_assignees a where a.task_id = new.task_id
      union
      -- Quien ya participó en el hilo quiere seguir enterándose.
      select c.autor from public.task_comments c where c.task_id = new.task_id
    ) d
   where d.user_id is not null
     and d.user_id is distinct from new.autor;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Historial: dejar rastro de quién se suma o se sale del equipo.
-- ---------------------------------------------------------------------------
create or replace function public.log_coasignacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_persona text;
  v_uid     uuid := coalesce(new.user_id, old.user_id);
  v_task    uuid := coalesce(new.task_id, old.task_id);
begin
  select nombre into v_persona from public.profiles where id = v_uid;
  insert into public.task_activity (task_id, autor, texto)
    values (v_task, auth.uid(),
            case when tg_op = 'INSERT' then 'sumó a ' else 'quitó a ' end ||
            coalesce(v_persona, 'alguien') || ' de la tarea');
  return coalesce(new, old);
end;
$$;

drop trigger if exists task_assignees_log on public.task_assignees;
create trigger task_assignees_log
  after insert or delete on public.task_assignees
  for each row execute function public.log_coasignacion();

notify pgrst, 'reload schema';
