-- ============================================================================
-- 20260918000000_portal_actividad_final.sql — Fase 4: el expediente se cierra
-- ----------------------------------------------------------------------------
-- `actividad_empresas` existe desde la fase 1 y los triggers de tareas,
-- documentos y avance ya la llenan. Esta migración remata lo que faltaba:
--
--   1. Los cambios de PERMISOS de la gente del portal también son evidencia:
--      quién le dio acceso a quién, cuándo, y con qué papel. Es la respuesta a
--      «¿desde cuándo puede Fulano ver esto?».
--   2. Los comentarios en tareas compartidas: lo que se DICE en el hilo con el
--      cliente es la mitad de lo que después se discute.
--   3. La retención NO la toca: se comprueba que `purgar_logs` (20260830) siga
--      sin conocer esta tabla. El resto de los logs se poda a 90 días; el
--      expediente de un cliente se queda.
--   4. La autocomprobación de inmutabilidad, esta vez de todo el juego.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Cambios de acceso al portal
-- ---------------------------------------------------------------------------
-- Dispara solo cuando cambian las columnas del portal: el resto de las
-- ediciones de perfil (nombre, color, área) no son de este expediente.
create or replace function public.log_actividad_acceso_portal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor  uuid := auth.uid();
  v_nombre text;
begin
  if new.empresa_id is not distinct from old.empresa_id
     and new.rol_portal is not distinct from old.rol_portal
     and (new.rol is not distinct from old.rol
          or ('externo' not in (new.rol, old.rol))) then
    return new;
  end if;

  select nombre into v_nombre from public.profiles where id = v_actor;

  insert into public.actividad_empresas
    (empresa_id, actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
  values (coalesce(new.empresa_id, old.empresa_id), v_actor, v_nombre,
          'acceso_portal_cambiado', 'perfil', new.id,
          jsonb_build_object(
            'persona', new.nombre,
            'antes', jsonb_build_object('rol', old.rol, 'rol_portal', old.rol_portal,
                                        'empresa_id', old.empresa_id),
            'despues', jsonb_build_object('rol', new.rol, 'rol_portal', new.rol_portal,
                                          'empresa_id', new.empresa_id)));
  return new;
end;
$$;

drop trigger if exists profiles_log_acceso_portal on public.profiles;
create trigger profiles_log_acceso_portal
  after update on public.profiles
  for each row execute function public.log_actividad_acceso_portal();

-- ---------------------------------------------------------------------------
-- 2) Comentarios en tareas del espacio compartido
-- ---------------------------------------------------------------------------
-- Solo las del espacio agencia con visibilidad compartida: el hilo interno del
-- tablero de Fresafit ya tiene su historial (`task_activity`) y no es evidencia
-- frente a un tercero. El texto se guarda RECORTADO: el expediente dice que se
-- dijo y quién; el hilo completo sigue en la tarea.
create or replace function public.log_actividad_comentario_compartido()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_nombre  text;
  v_tarea   record;
begin
  select empresa_id, titulo, visibilidad, espacio into v_tarea
    from public.tasks where id = new.task_id;

  if not found or v_tarea.espacio <> 'agencia' or v_tarea.visibilidad <> 'compartido' then
    return new;
  end if;

  select nombre into v_nombre from public.profiles where id = new.autor;

  insert into public.actividad_empresas
    (empresa_id, actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
  values (v_tarea.empresa_id, new.autor, v_nombre, 'comentario_compartido', 'tarea', new.task_id,
          jsonb_build_object('tarea', v_tarea.titulo,
                             'resumen', left(regexp_replace(new.texto, '\s+', ' ', 'g'), 140)));
  return new;
end;
$$;

drop trigger if exists task_comments_log_compartido on public.task_comments;
create trigger task_comments_log_compartido
  after insert on public.task_comments
  for each row execute function public.log_actividad_comentario_compartido();

-- ---------------------------------------------------------------------------
-- 3) La retención no alcanza al expediente
-- ---------------------------------------------------------------------------
-- `purgar_logs` poda notificaciones y logs de stock a 90 días. Si algún día
-- alguien la reescribe y le agrega esta tabla, este check lo delata al pegar la
-- migración de retención siguiente — y el comment de la tabla ya lo advierte.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'purgar_logs'
      and pg_get_functiondef(p.oid) ilike '%actividad_empresas%'
  ) then
    raise exception 'purgar_logs() toca actividad_empresas: el expediente NO se poda. Revisa 20260830000000.';
  end if;
  raise notice 'OK — purgar_logs no conoce el expediente.';
end $$;

-- ---------------------------------------------------------------------------
-- 4) Autocomprobación final de inmutabilidad
-- ---------------------------------------------------------------------------
-- La de 20260914 probó el trigger recién creado; esta prueba TODO el juego tal
-- como quedó después de tres fases de migraciones: sin policies de UPDATE ni
-- DELETE, con los privilegios revocados y con el trigger vivo.
do $$
declare
  v_policies int;
  v_trigger  boolean;
begin
  select count(*) into v_policies
    from pg_policies
   where schemaname = 'public' and tablename = 'actividad_empresas'
     and cmd in ('UPDATE','DELETE');
  if v_policies > 0 then
    raise exception 'actividad_empresas tiene % policies de UPDATE/DELETE: el expediente dejó de ser inalterable.', v_policies;
  end if;

  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.actividad_empresas'::regclass
      and tgname = 'actividad_empresas_inmutable' and tgenabled <> 'D'
  ) into v_trigger;
  if not v_trigger then
    raise exception 'El trigger actividad_empresas_inmutable no está (o está deshabilitado).';
  end if;

  if has_table_privilege('authenticated', 'public.actividad_empresas', 'UPDATE')
     or has_table_privilege('authenticated', 'public.actividad_empresas', 'DELETE') then
    raise exception 'authenticated recuperó UPDATE/DELETE sobre actividad_empresas: revoca de nuevo.';
  end if;

  raise notice 'OK — el expediente sigue siendo solo de escritura: sin policies de cambio, sin privilegios y con el trigger vivo.';
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   -- El expediente de un cliente, como lo verá dirección:
--   select created_at, actor_nombre, accion, entidad, detalle->>'titulo'
--     from public.actividad_empresas
--    order by created_at desc limit 30;
--
--   -- Y que de verdad no se puede tocar (debe fallar):
--   update public.actividad_empresas set accion = 'x' where id = 1;
-- ============================================================================
