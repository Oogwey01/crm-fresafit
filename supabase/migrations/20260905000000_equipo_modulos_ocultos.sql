-- ============================================================================
-- 20260905000000_equipo_modulos_ocultos.sql
--   Restringir secciones sueltas a una persona, desde /equipo.
-- ----------------------------------------------------------------------------
-- El rol dice el techo (qué PODRÍA ver alguien) y `ve_agencia` abre o cierra el
-- otro negocio. Faltaba el grano fino: «Germán no tiene por qué entrar a
-- Métricas», sin cambiarle el rol ni inventar uno nuevo por cada combinación.
--
-- `profiles.modulos_ocultos` es esa lista: los ids de MODULOS (lib/catalogos.ts)
-- que esa persona NO ve. Vacío = ve todo lo que su rol permita, que es como
-- está hoy el equipo entero, así que la migración no le cambia nada a nadie.
--
-- Es una lista NEGRA a propósito: solo QUITA. Nunca da acceso que el rol no
-- diera ya, y eso no es una limitación de la pantalla sino de la base — los
-- módulos de dinero los cierra la RLS (`es_administrativo()`, `es_admin()`), así
-- que «dar» Finanzas a un miembro desde aquí solo le pintaría una pantalla que
-- la base le devolvería vacía. El techo se sube cambiando el rol.
--
-- Va como columna y no como tabla puente (que es lo que hace
-- `dinero_permisos_canal`) porque esto se pregunta en CADA request para pintar
-- el menú: el perfil ya viaja en esa consulta y una lista corta de texto no
-- justifica un JOIN por página. Los permisos de canal, en cambio, se consultan
-- aparte y solo cuando hace falta.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.profiles
  add column if not exists modulos_ocultos text[] not null default '{}';

comment on column public.profiles.modulos_ocultos is
  'Ids de MODULOS (lib/catalogos.ts) que esta persona NO ve. Lista negra: solo resta sobre lo que ya permite su rol. Se cambia desde /equipo (solo dirección).';

-- ---------------------------------------------------------------------------
-- La guarda: se congela igual que `rol`, `area` y `ve_agencia`. Sin esto,
-- cualquiera podría vaciarse la lista con un PATCH a su propia fila (la policy
-- "perfiles: actualizar propio o admin" deja escribir la fila de uno mismo).
-- Sigue SIN `security definer`, para que `request.jwt.claim.role` y `auth.uid()`
-- hablen de quien hizo la petición (ver 20260829000000_higiene.sql).
-- ---------------------------------------------------------------------------
create or replace function public.proteger_columnas_profiles()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_rol text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims',     true), '')::jsonb ->> 'role',
    '');
begin
  -- Procesos sin persona detrás (seed, altas con la llave de servicio, SQL
  -- Editor, cron por conexión directa).
  if v_rol = 'service_role'
     or (auth.uid() is null and session_user in ('postgres','supabase_admin'))
  then
    return new;
  end if;

  -- Dirección: reparte rol, área, Agencia y secciones de quien sea.
  if public.es_admin(auth.uid()) then
    return new;
  end if;

  -- Todos los demás: se conservan los cuatro permisos; nombre y color sí los
  -- cambia cada quien en su propia fila.
  new.rol             := old.rol;
  new.area            := old.area;
  new.ve_agencia      := old.ve_agencia;
  new.modulos_ocultos := old.modulos_ocultos;
  return new;
end;
$$;

drop trigger if exists profiles_proteger_columnas on public.profiles;
create trigger profiles_proteger_columnas
  before update on public.profiles
  for each row execute function public.proteger_columnas_profiles();

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select nombre, rol, ve_agencia, modulos_ocultos
--     from public.profiles order by nombre;
--
-- Todos deben salir con `modulos_ocultos` vacío ({}): nadie tiene restricciones
-- hasta que se le pongan desde /equipo.
-- ============================================================================
