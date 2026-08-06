-- ============================================================================
-- 20260903000000_tareas_crear_todo_el_equipo.sql
--   Crear tareas deja de ser privilegio de gestor: lo puede hacer TODO el
--   equipo de casa (dirección, administración, coordinación y miembros).
-- ----------------------------------------------------------------------------
-- Hasta ahora un miembro solo podía mover el estado de lo que le pusieran, así
-- que sus propios pendientes vivían fuera del CRM (libreta, WhatsApp, memoria).
-- Con esto cualquiera del equipo abre su tarea y se la asigna a quien toque.
--
-- Reglas que quedan (lo acordado):
--   * Crear:  cualquiera del equipo interno. `externo` NO — ese rol sigue
--             viendo solo lo que se le comparte, y no tiene equipo al que
--             asignar ni tablero donde poner nada.
--   * Asignar: a quien sea del equipo, también al crear. La tarea nace con
--             responsable y el trigger `notificar_asignacion` ya le avisa.
--   * Corregir/borrar: quien la CREÓ manda sobre ella —título, fecha,
--             prioridad, etiquetas, responsable y papelera— aunque no sea
--             gestor. Sin esto no podría ni arreglarle un dedazo a su propia
--             tarea. Lo único que no puede es regalarla (cambiar `created_by`)
--             ni mudarla de tablero (`espacio`).
--   * Quien solo la TRABAJA (responsable o acompañante, sin haberla creado)
--             sigue como hasta hoy: mueve el estado, comenta y adjunta.
--
-- De paso se cierra un hueco viejo: el trigger no congelaba `deleted_at`, así
-- que una persona asignada podía mandar a la papelera —llamando la API a mano—
-- una tarea que no era suya. Ahora se conserva como el resto de las columnas.
--
-- Las políticas se escriben con las llamadas de rol envueltas en `(select …)`,
-- que es la forma que dejó 20260824000000_rls_initplan.sql: sin eso Postgres
-- evalúa la función UNA VEZ POR FILA en vez de una vez por consulta (se midió
-- 35× más lento en el tablero).
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Helper: ¿manda sobre esta tarea? (gestor, o quien la creó)
--    Va como función porque `task_assignees` no tiene la columna `created_by`
--    y necesita preguntarlo por el id de la tarea. SECURITY DEFINER para leer
--    `tasks` sin recursión de RLS, igual que es_asignado_tarea().
-- ---------------------------------------------------------------------------
create or replace function public.puede_gestionar_tarea(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_gestor()
      or exists (
        select 1 from public.tasks t
        where t.id = tid and t.created_by = auth.uid()
      );
$$;

grant execute on function public.puede_gestionar_tarea(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) tasks: crear, editar y borrar
-- ---------------------------------------------------------------------------
-- Crear: todo el equipo interno, y siempre a nombre propio (`created_by` no se
-- puede falsear).
drop policy if exists "tareas: crear (solo gestor)"      on public.tasks;
drop policy if exists "tareas: crear (equipo interno)"   on public.tasks;
create policy "tareas: crear (equipo interno)" on public.tasks
  for insert to authenticated
  with check ((select public.es_interno()) and created_by = (select auth.uid()));

-- Editar: gestor, quien la trabaja (solo el estado; lo acota el trigger) y
-- ahora también quien la creó. `created_by` se compara contra la columna en
-- vez de llamar a puede_gestionar_tarea(id): es la misma fila que ya se está
-- leyendo, así que sale gratis.
drop policy if exists "tareas: editar (gestor o responsable)" on public.tasks;
create policy "tareas: editar (gestor o responsable)" on public.tasks
  for update to authenticated
  using (
    (select public.es_gestor())
    or created_by = (select auth.uid())
    or public.es_asignado_tarea(id)
  )
  with check (
    (select public.es_gestor())
    or created_by = (select auth.uid())
    or public.es_asignado_tarea(id)
  );

-- Borrado DEFINITIVO (el suave es un update de `deleted_at`): gestor o quien la
-- creó. Lo que uno abre por error, uno lo puede tirar.
drop policy if exists "tareas: borrar (solo gestor)" on public.tasks;
drop policy if exists "tareas: borrar (gestor o creador)" on public.tasks;
create policy "tareas: borrar (gestor o creador)" on public.tasks
  for delete to authenticated
  using ((select public.es_gestor()) or created_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3) Trigger: qué puede tocar cada quien en un UPDATE
--    (RLS es por fila, no por columna; esto es lo que separa "mover el estado"
--    de "editar la tarea".)
--
--    Se conserva sin `security definer` a propósito: dentro de una función así
--    `current_user` sería el dueño (postgres) y la primera guarda se cumpliría
--    siempre —el bug que documenta 20260817000000_tareas_coasignados.sql—.
-- ---------------------------------------------------------------------------
create or replace function public.restringir_update_tarea()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or public.es_gestor() then
    return new;
  end if;

  -- Quien creó la tarea manda sobre ella: la corrige entera y la manda a la
  -- papelera. Lo único que no puede es regalarla ni mudarla de tablero.
  -- El `is not null` importa: hay tareas viejas sin `created_by`, y sin él una
  -- sesión sin auth.uid() (null = null bajo `is not distinct from`) entraría
  -- aquí como si las hubiera creado.
  if old.created_by is not null and old.created_by = auth.uid() then
    new.created_by := old.created_by;
    new.espacio    := old.espacio;
    return new;
  end if;

  if not public.es_asignado_tarea(old.id) then
    raise exception 'Solo quien trabaja la tarea o dirección/coordinación puede modificarla.';
  end if;

  -- Persona asignada que NO la creó: se conservan todas las columnas salvo
  -- `estado` (y su motivo, que va con él).
  new.titulo         := old.titulo;
  new.descripcion    := old.descripcion;
  new.responsable_id := old.responsable_id;
  new.area           := old.area;
  new.prioridad      := old.prioridad;
  new.fecha_limite   := old.fecha_limite;
  new.etiquetas      := old.etiquetas;
  new.created_by     := old.created_by;
  new.espacio        := old.espacio;
  new.deleted_at     := old.deleted_at;
  return new;
end;
$$;

drop trigger if exists tasks_restringir_update on public.tasks;
create trigger tasks_restringir_update
  before update on public.tasks
  for each row execute function public.restringir_update_tarea();

-- ---------------------------------------------------------------------------
-- 4) task_assignees: el equipo de una tarea lo arma quien manda en ella
--    (antes, solo gestor: un miembro no podía crear su tarea con acompañantes).
-- ---------------------------------------------------------------------------
drop policy if exists "coasignados: gestionar (solo gestor)"      on public.task_assignees;
drop policy if exists "coasignados: gestionar (gestor o creador)" on public.task_assignees;
create policy "coasignados: gestionar (gestor o creador)" on public.task_assignees
  for all to authenticated
  using (public.puede_gestionar_tarea(task_id))
  with check (public.puede_gestionar_tarea(task_id));

notify pgrst, 'reload schema';
