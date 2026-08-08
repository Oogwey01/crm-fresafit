-- ============================================================================
-- 20260919000000_maquila_permisos.sql
--   El rol `maquilero`: Eduardo entra al CRM, y solo a su tablero.
-- ----------------------------------------------------------------------------
-- El módulo "Maquila México" mete al CRM a una persona que no es del equipo ni
-- es un cliente del portal: Eduardo PRODUCE los cinturones bajo pedido y
-- necesita ver qué fabricar, para cuándo y con qué guía salió — y nada más.
--
-- No puede ser `externo`: ese rol quedó amarrado al portal de empresas en
-- 20260914000000_portal_base.sql (`profiles_externo_empresa_check` exige
-- empresa_id, `rol_portal`, y toda su RLS habla de `mi_empresa()`). Eduardo no
-- tiene empresa cliente; forzarlo ahí sería mentirle a esas guardas.
--
-- Tampoco un permiso sobre un rol de casa: `es_interno()` abre casi todas las
-- tablas del CRM, y lo que se busca es lo contrario — que por defecto no vea
-- NADA. Por eso es un rol nuevo. Los helpers de rol son listas blancas
-- (`es_interno`, `es_gestor`, `es_administrativo` enumeran roles), así que
-- `maquilero` nace fuera de todo; las tablas de maquila le abrirán lo suyo
-- explícitamente con `es_maquilero()`, igual que el portal hace con
-- `es_externo()`.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1) El rol entra al catálogo. Espejo de ROLES en lib/catalogos.ts.
--    Las guardas del portal ya lo tratan bien sin tocarlas:
--      · profiles_externo_empresa_check: (rol='externo') = (empresa_id no nulo)
--        → maquilero sin empresa pasa (false = false).
--      · profiles_rol_portal_check: rol <> 'externo' exige rol_portal null → pasa.
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_rol_check;
alter table public.profiles
  add constraint profiles_rol_check
  check (rol in ('direccion','administracion','coordinador','miembro','externo','maquilero'));

-- ---------------------------------------------------------------------------
-- 2) El helper para la RLS de las tablas de maquila. Mismo patrón que
--    es_interno()/es_externo(): security definer para leer profiles sin
--    disparar su propia RLS, stable, search_path fijo.
-- ---------------------------------------------------------------------------
create or replace function public.es_maquilero()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and rol = 'maquilero'
  );
$$;
grant execute on function public.es_maquilero() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) El maquilero puede leer perfiles del equipo de casa (para pintar "quién
--    movió qué" en su historial), pero no a los externos de las empresas
--    cliente — y viceversa: el portal no tiene por qué saber que existe un
--    maquilero. La policy de 20260914000000_portal_base.sql se recrea con la
--    rama nueva; para el equipo interno no cambia nada.
-- ---------------------------------------------------------------------------
drop policy if exists "perfiles: leer (equipo y su empresa)" on public.profiles;
create policy "perfiles: leer (equipo y su empresa)"
  on public.profiles for select
  to authenticated
  using (
    (select public.es_interno())
    or id = (select auth.uid())
    or (
      (select public.es_externo())
      and (
        rol not in ('externo','maquilero')            -- el equipo que le atiende
        or empresa_id = (select public.mi_empresa())  -- sus propios compañeros
      )
    )
    or (
      (select public.es_maquilero())
      and rol not in ('externo','maquilero')          -- solo el equipo de casa
    )
  );

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.profiles'::regclass and conname = 'profiles_rol_check';
--     -- debe incluir 'maquilero'
--   select public.es_maquilero();   -- false (el SQL Editor no es maquilero)
--
-- El alta real de Eduardo se hace después, con el script:
--   node --env-file=.env.local scripts/crear-usuario.mjs \
--     --email eduardo@… --nombre "Eduardo" --rol maquilero --password "…"
-- ============================================================================
