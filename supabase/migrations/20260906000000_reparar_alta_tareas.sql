-- ============================================================================
-- 20260906000000_reparar_alta_tareas.sql
--   El alta de tareas seguía pidiendo ser gestor. Repara y comprueba.
-- ----------------------------------------------------------------------------
-- Síntoma: «new row violates row-level security policy for table "tasks"» al
-- crear una tarea con una cuenta de miembro. Medido contra la base en vivo,
-- abriendo sesión como cada quien:
--
--   Germán  (miembro)      es_interno=true  es_gestor=false  → INSERT rechazado
--   Aarón   (dirección)    es_interno=true  es_gestor=true   → INSERT aceptado
--   Julio   (coordinador)  es_interno=true  es_gestor=true   → INSERT aceptado
--
-- Es exactamente el comportamiento de la política vieja, «tareas: crear (solo
-- gestor)». El resto de 20260903000000 SÍ quedó aplicado —se comprobó que un
-- miembro ya puede editar y mandar a la papelera una tarea suya, cosa que solo
-- permiten la política de UPDATE y el trigger nuevos—, así que lo único fuera
-- de sitio es la política de alta.
--
-- Por qué puede pasar: dos políticas PERMISIVAS se suman (basta que una deje
-- pasar), así que si la nueva estuviera junto a la vieja, un miembro entraría.
-- Que NO entre significa que en la tabla manda otra cosa: una política de alta
-- con un nombre que el `drop` de aquella migración no acertó, o una RESTRICTIVA
-- —que en vez de sumar, resta— creada a mano en algún momento.
--
-- En vez de adivinar el nombre, esto borra TODAS las políticas de INSERT que
-- haya sobre `tasks`, sean cuales sean, y deja una sola. De paso las imprime
-- con `raise notice`, así que el SQL Editor deja ver en su panel de mensajes
-- qué había ahí — que es la respuesta a por qué pasó.
--
-- Idempotente: se puede pegar tal cual, y volver a pegarlo cuantas veces haga
-- falta. Termina lanzando un error si el resultado no es el esperado, para que
-- no vuelva a quedar «aplicada con éxito» sin estarlo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Fuera cualquier política de alta que haya hoy (y decir cuál era).
-- ---------------------------------------------------------------------------
do $$
declare
  p record;
  n int := 0;
begin
  for p in
    select policyname, permissive, cmd, roles, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'tasks' and cmd in ('INSERT', 'ALL')
     order by cmd, policyname
  loop
    raise notice 'Encontrada → "%" | % | % | roles=% | with check: %',
      p.policyname, p.permissive, p.cmd, p.roles, coalesce(p.with_check, '(ninguno)');

    if p.cmd = 'INSERT' then
      execute format('drop policy %I on public.tasks', p.policyname);
      n := n + 1;
    else
      -- Una política FOR ALL cubre también el alta. No se borra a ciegas
      -- (gobierna además select/update/delete), pero hay que saber que está.
      raise warning '  ↑ es FOR ALL: también gobierna el alta. Revísala si el problema sigue.';
    end if;
  end loop;
  raise notice 'Políticas de alta retiradas: %', n;
end $$;

-- ---------------------------------------------------------------------------
-- 2) La buena, y sola: crea tarea todo el equipo de casa, siempre a nombre
--    propio. `externo` queda fuera (no pasa es_interno()).
--    Las llamadas van envueltas en (select …) por el InitPlan — ver
--    20260824000000_rls_initplan.sql.
-- ---------------------------------------------------------------------------
create policy "tareas: crear (equipo interno)" on public.tasks
  for insert to authenticated
  with check ((select public.es_interno()) and created_by = (select auth.uid()));

-- El permiso de tabla es aparte de la RLS: si faltara, el error sería
-- «permission denied» en vez del de política. Es idempotente y no abre nada
-- que la RLS no gobierne igual.
grant insert on public.tasks to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Autocomprobación: si esto no queda como debe, que FALLE aquí y ahora.
--    El fallo silencioso es justo lo que hizo falta descubrir a mano.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n     int;
  v_check text;
begin
  select count(*), max(with_check) into v_n, v_check
    from pg_policies
   where schemaname = 'public' and tablename = 'tasks' and cmd = 'INSERT';

  if v_n <> 1 then
    raise exception 'Quedaron % políticas de alta en tasks; debería haber exactamente 1.', v_n;
  end if;
  if v_check is null or v_check not like '%es_interno%' then
    raise exception 'La política de alta no es la nueva. Dice: %', coalesce(v_check, '(nada)');
  end if;

  raise notice 'OK — alta de tareas: %', v_check;
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (opcional, para verlo con los ojos)
-- ----------------------------------------------------------------------------
--   select policyname, permissive, cmd, with_check
--     from pg_policies
--    where schemaname = 'public' and tablename = 'tasks'
--    order by cmd, policyname;
--
-- En `cmd = INSERT` debe haber una sola, PERMISSIVE, y su with check debe
-- nombrar es_interno(). Si aparece alguna RESTRICTIVE, esa es la culpable.
-- ============================================================================
