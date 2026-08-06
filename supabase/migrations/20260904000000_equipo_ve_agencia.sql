-- ============================================================================
-- 20260904000000_equipo_ve_agencia.sql
--   Quién entra a la Agencia se decide POR PERSONA, no por rol.
-- ----------------------------------------------------------------------------
-- La Agencia la llevan cuatro: Aarón, Diego Armando, Julio y Manuel. Y eso no
-- se puede escribir como una regla de rol: René es dirección y no entra; Diana
-- es administración y tampoco. Por eso es un permiso por persona.
--
-- `profiles.ve_agencia` es ese permiso. Sin él, el selector Fresafit/Agencia no
-- aparece siquiera en el menú y las rutas /agencia devuelven a Fresafit.
--
-- OJO con Diana: hoy los Cobros, la Nómina y los Reportes de la Agencia son
-- suyos (rol `administracion`), y al no estar en la lista los pierde. Si eso no
-- era la intención, se le marca desde la pantalla de Equipo — es un clic, ya no
-- hace falta SQL.
--
-- El permiso lo cambia SOLO dirección, desde /equipo. Se apoya en el trigger
-- `proteger_columnas_profiles`, que ya congelaba `rol` y `area` para todos los
-- demás y que aquí gana la columna nueva: sin eso, cualquiera podría darse
-- acceso a la Agencia con un PATCH a su propia fila (`perfiles: actualizar
-- propio o admin` deja escribir la fila de uno mismo).
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) La columna. Por defecto NADIE ve la Agencia: es un permiso que se da, no
--    uno que se quita.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists ve_agencia boolean not null default false;

comment on column public.profiles.ve_agencia is
  'Permiso por persona para entrar al espacio Agencia (selector del menú y rutas /agencia). Lo cambia dirección desde /equipo.';

-- ---------------------------------------------------------------------------
-- 2) Los cuatro que la llevan. Por correo de Auth, que es lo estable: los ids
--    cambian entre entornos y el nombre se puede corregir cualquier día.
--    `where` sobre el update para que la migración sea inocua si algún correo
--    todavía no existe en este entorno.
-- ---------------------------------------------------------------------------
update public.profiles p
   set ve_agencia = true
  from auth.users u
 where u.id = p.id
   and lower(u.email) in (
     'aaron@fresafit.com.mx',      -- Aaron Oviedo
     'armando@fresafit.com.mx',    -- Diego Armando Duarte Palacios
     'juliozea10@gmail.com',       -- Julio Enrique Zea Silva
     'manuel@fresafit.com.mx'      -- Manuel Enrique Barrera Rodríguez
   )
   and p.ve_agencia is distinct from true;

-- ---------------------------------------------------------------------------
-- 3) La guarda: `ve_agencia` se congela igual que `rol` y `area`.
--    Misma función de 20260829000000_higiene.sql, con la columna nueva. Se
--    mantiene SIN `security definer` a propósito: así `request.jwt.claim.role`
--    y `auth.uid()` siguen hablando de QUIEN HIZO LA PETICIÓN y no del dueño de
--    la función (ver el comentario largo de aquella migración).
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

  -- Dirección: cambia rol, área y el acceso a la Agencia de quien sea.
  if public.es_admin(auth.uid()) then
    return new;
  end if;

  -- Todos los demás: se conservan rol, área y el acceso a la Agencia; el resto
  -- (nombre, color) sí lo puede cambiar cada quien en su propia fila.
  new.rol        := old.rol;
  new.area       := old.area;
  new.ve_agencia := old.ve_agencia;
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
--   select p.nombre, p.rol, p.ve_agencia
--     from public.profiles p order by p.ve_agencia desc, p.nombre;
--
-- Deben salir en true exactamente cuatro: Aaron, Diego Armando, Julio y Manuel.
-- ============================================================================
