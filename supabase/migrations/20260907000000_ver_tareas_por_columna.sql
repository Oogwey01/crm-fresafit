-- ============================================================================
-- 20260907000000_ver_tareas_por_columna.sql
--   El alta de tareas fallaba para los miembros. La culpa era de la política de
--   LECTURA, no la de alta.
-- ----------------------------------------------------------------------------
-- Síntoma: «new row violates row-level security policy for table "tasks"» al
-- crear una tarea con cuenta de miembro. Sobrevivió a 20260903000000 y a
-- 20260906000000 porque ninguna de las dos tocaba la pieza culpable.
--
-- Medido contra la base en vivo: TODOS los gestores podían crear y NINGÚN
-- miembro, aunque `es_interno()` daba true para ellos y `created_by` era el
-- suyo. Reproducido después en un Postgres aparte, y el mecanismo es este:
--
--   * La app crea la tarea con INSERT … RETURNING id (necesita el id para
--     sumar a los acompañantes).
--   * En una tabla con RLS, el RETURNING pasa por la política de SELECT.
--   * Esa política era `using (puede_ver_tarea(id))`, y esa función es STABLE:
--     resuelve su `exists (select 1 from public.tasks t where t.id = tid …)`
--     contra el snapshot del inicio de la sentencia, donde la fila que se
--     acaba de insertar TODAVÍA NO ESTÁ. Devuelve false.
--   * Un gestor no lo notaba: sale por `es_gestor()` en la primera rama, sin
--     necesitar encontrar la fila. De ahí que fallara justo para los miembros.
--   * Postgres usa el MISMO mensaje para esto que para un WITH CHECK
--     incumplido, y por eso todo apuntaba a la política de alta.
--
-- Arreglo: que la política de lectura de `tasks` mire las COLUMNAS DE LA FILA
-- —que sí existen en la fila nueva— en vez de salir a buscarla. La regla no
-- cambia ni un ápice: gestor, o quien la trabaja, o quien la creó, o alguien
-- del equipo de la tarea, o alguien a quien se le compartió. Se comprobó contra
-- la base en vivo que hoy es exactamente eso (un miembro ve sus tareas y solo
-- las suyas, sin las de su área).
--
-- De paso es más rápido: se ahorra una subconsulta a `tasks` por cada fila que
-- se lee del tablero.
--
-- `puede_ver_tarea()` NO se toca: la usan las tablas satélite (comentarios,
-- subtareas, adjuntos…) preguntando por una tarea que ya existe, y ahí funciona
-- perfectamente. Solo se le añade una nota para que nadie repita el tropiezo.
--
-- Idempotente, y se comprueba a sí mismo al final: si el alta de un miembro
-- sigue fallando, esta migración lanza un error en vez de decir «success».
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) La política de lectura, sobre columnas de la fila.
--    Las llamadas de rol van envueltas en (select …) por el InitPlan, ver
--    20260824000000_rls_initplan.sql.
-- ---------------------------------------------------------------------------
drop policy if exists "tareas: ver segun rol" on public.tasks;
create policy "tareas: ver segun rol" on public.tasks
  for select to authenticated
  using (
    (select public.es_gestor())
    or responsable_id = (select auth.uid())
    or created_by     = (select auth.uid())
    or exists (
      select 1 from public.task_assignees a
       where a.task_id = id and a.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.task_shares s
       where s.task_id = id and s.user_id = (select auth.uid())
    )
  );

comment on function public.puede_ver_tarea(uuid) is
  'Visibilidad de una tarea, para las tablas satélite (comentarios, subtareas, enlaces, adjuntos, actividad), que preguntan por una tarea YA existente. OJO: no sirve en la política de select de `tasks` misma — es STABLE y busca la fila dentro de tasks, así que en un INSERT … RETURNING la fila nueva aún no está en su snapshot y devuelve false. Ver 20260907000000.';

-- ---------------------------------------------------------------------------
-- 2) Autocomprobación DE VERDAD: se intenta el alta exactamente como la hace la
--    app —INSERT … RETURNING— haciéndose pasar por un miembro, y se deshace.
--    El bloque interior es una subtransacción: al capturar la excepción se
--    revierte lo insertado, así que la prueba no deja rastro.
-- ---------------------------------------------------------------------------
do $$
declare
  v_miembro uuid;
  v_id      uuid;
  v_error   text;
begin
  select id into v_miembro from public.profiles where rol = 'miembro' order by nombre limit 1;
  if v_miembro is null then
    raise notice 'No hay ningún perfil con rol miembro: no se pudo probar el alta.';
    return;
  end if;

  -- Hacerse pasar por esa persona: rol de la petición + auth.uid().
  perform set_config('request.jwt.claim.sub', v_miembro::text, true);
  set local role authenticated;

  begin
    insert into public.tasks (titulo, responsable_id, created_by, area, prioridad, estado, espacio)
      values ('«prueba de la migración 20260907»', v_miembro, v_miembro,
              'operaciones', 'baja', 'por_hacer', 'fresafit')
      returning id into v_id;
    -- Deshacer: lanzar y capturar revierte esta subtransacción entera.
    raise exception 'ok_deshacer';
  exception
    when others then
      v_error := sqlerrm;
  end;

  reset role;

  if v_error is distinct from 'ok_deshacer' then
    raise exception 'El alta de tareas SIGUE fallando para un miembro: %', v_error;
  end if;

  raise notice 'OK — un miembro puede crear su tarea (probado con INSERT … RETURNING y deshecho).';
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (opcional, para verlo con los ojos)
-- ----------------------------------------------------------------------------
--   select policyname, cmd, qual
--     from pg_policies
--    where schemaname = 'public' and tablename = 'tasks' and cmd = 'SELECT';
--
-- Su `qual` debe nombrar responsable_id / created_by, y NO puede_ver_tarea.
-- ============================================================================
