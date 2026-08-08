-- ============================================================================
-- 20260914000000_portal_base.sql — Fase 1a: los cimientos del portal de clientes
-- ----------------------------------------------------------------------------
-- La agencia atiende empresas (Nutravia, Bart Jerseys) y hoy todo lo que se
-- piden mutuamente vive en WhatsApp. El módulo «CRM para Empresas» les abre un
-- espacio compartido dentro del CRM: tareas de ida y vuelta, documentos y
-- avance. Esta migración NO trae ninguna de esas tres cosas; trae lo que hay
-- que dejar bien antes de tocarlas, porque parchear permisos después es cómo se
-- filtran los datos.
--
-- Cuatro piezas:
--
--   1) Cada persona de fuera queda amarrada a SU empresa (`profiles.empresa_id`)
--      y con un papel dentro de ella (`profiles.rol_portal`).
--   2) Los helpers que la RLS usará en todas las tablas del módulo:
--      `es_externo()`, `es_externo_admin()`, `mi_empresa()`.
--   3) Se CIERRA la lectura de `profiles`, que hoy es `using (true)`. Sin esto,
--      el primer cliente que entre se lleva el directorio completo del equipo y
--      los nombres de los OTROS clientes. Es el agujero que abre el portal.
--   4) `actividad_empresas`: el registro inalterable. Se crea desde ya, aunque
--      su pantalla llegue en la última fase, porque una bitácora que empieza a
--      llenarse tres fases tarde no sirve como evidencia de lo que pasó antes.
--
-- El rol `externo` ya existía en el CHECK de `profiles.rol` desde
-- 20260819000000, descrito en lib/catalogos.ts como «solo ve lo que se le
-- comparte». Nunca se usó: hasta hoy la RLS no le daba NADA (todas las tablas
-- piden `es_interno()` o más). Ese es justo el punto de partida que se quiere —
-- se abre solo lo que cada fase comparta a propósito.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) La persona de fuera pertenece a una empresa
-- ---------------------------------------------------------------------------
-- Una columna y no una tabla puente: un contacto de Nutravia es de Nutravia y
-- de nadie más. El día que alguien atienda a dos clientes (no ha pasado, y sería
-- raro: son empresas que compiten por nuestro tiempo, no socias) se migra a
-- puente sin perder nada — la columna se vuelve la fila de esa tabla.
alter table public.profiles
  add column if not exists empresa_id uuid references public.agencia_empresas(id) on delete restrict,
  add column if not exists rol_portal text;

-- `on delete restrict` y no `set null` a propósito: borrar una empresa que aún
-- tiene gente dentro dejaría cuentas huérfanas con rol externo y sin empresa,
-- que es exactamente el estado que la RLS de abajo no sabe interpretar. Primero
-- se dan de baja las personas.

comment on column public.profiles.empresa_id is
  'Empresa cliente a la que pertenece esta persona. Solo tiene valor para rol=externo; el equipo de casa la lleva en null.';
comment on column public.profiles.rol_portal is
  'Papel dentro de la empresa cliente: admin_cliente (crea tareas) o colaborador (comenta y sube archivos). Null para el equipo de casa.';

-- Las dos van juntas o no van: un externo sin empresa no podría ver nada y un
-- interno con empresa confundiría a la RLS. La BD lo frena en vez de confiar en
-- que el alta se haga bien.
alter table public.profiles drop constraint if exists profiles_externo_empresa_check;
alter table public.profiles
  add constraint profiles_externo_empresa_check
  check ((rol = 'externo') = (empresa_id is not null));

alter table public.profiles drop constraint if exists profiles_rol_portal_check;
alter table public.profiles
  add constraint profiles_rol_portal_check
  check (
    (rol = 'externo' and rol_portal in ('admin_cliente','colaborador'))
    or (rol <> 'externo' and rol_portal is null)
  );

create index if not exists profiles_empresa_idx
  on public.profiles(empresa_id) where empresa_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Los helpers de la RLS del módulo
-- ---------------------------------------------------------------------------
-- Mismo patrón que `es_interno()` / `es_gestor()` (20260819000000): SECURITY
-- DEFINER para que consultar `profiles` desde una policy no dispare la RLS de
-- `profiles` otra vez, `stable` para que el planner las resuelva una vez por
-- sentencia, y `search_path` fijo.
create or replace function public.es_externo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and rol = 'externo'
  );
$$;

-- Quien puede PEDIR cosas desde el lado del cliente. El colaborador comenta,
-- adjunta y cierra lo suyo, pero no abre tareas nuevas ni cierra las nuestras.
create or replace function public.es_externo_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and rol = 'externo' and rol_portal = 'admin_cliente'
  );
$$;

-- El corte que aísla a un cliente de otro. Devuelve null para el equipo de casa,
-- y por eso TODA policy que la use debe ir acompañada de `es_externo()`: una
-- comparación contra null no es true, pero dejarlo al azar de la lógica ternaria
-- de SQL es cómo se cuelan las filas.
create or replace function public.mi_empresa()
returns uuid language sql stable security definer set search_path = public as $$
  select empresa_id from public.profiles where id = auth.uid();
$$;

grant execute on function public.es_externo()       to authenticated;
grant execute on function public.es_externo_admin() to authenticated;
grant execute on function public.mi_empresa()       to authenticated;

-- ---------------------------------------------------------------------------
-- 3) `empresa_id` y `rol_portal` se congelan igual que el rol
-- ---------------------------------------------------------------------------
-- Sin esto, un externo se cambia de empresa con un PATCH a su propia fila: la
-- policy "perfiles: actualizar propio o admin" (20250101000001_rls.sql) le deja
-- escribir su fila, y `mi_empresa()` es lo único que separa a Nutravia de Bart
-- Jerseys. Es el mismo trigger de 20260905000000 con dos columnas más.
--
-- Sigue SIN `security definer`, para que `auth.uid()` y `request.jwt.claim.role`
-- hablen de quien hizo la petición (ver 20260829000000_higiene.sql).
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

  -- Dirección: reparte rol, área, Agencia, secciones y empresa de quien sea.
  if public.es_admin(auth.uid()) then
    return new;
  end if;

  -- Todos los demás: se conservan los permisos; nombre y color sí los cambia
  -- cada quien en su propia fila.
  new.rol             := old.rol;
  new.area            := old.area;
  new.ve_agencia      := old.ve_agencia;
  new.modulos_ocultos := old.modulos_ocultos;
  new.empresa_id      := old.empresa_id;
  new.rol_portal      := old.rol_portal;
  return new;
end;
$$;

drop trigger if exists profiles_proteger_columnas on public.profiles;
create trigger profiles_proteger_columnas
  before update on public.profiles
  for each row execute function public.proteger_columnas_profiles();

-- ---------------------------------------------------------------------------
-- 4) Se cierra la lectura de `profiles`
-- ---------------------------------------------------------------------------
-- Era `using (true)` desde el primer día, y estaba bien cuando todos los
-- autenticados eran el equipo. Con gente de fuera adentro, esa línea le entrega
-- a Nutravia el directorio completo —quién es dirección, quién administración— y
-- los nombres de los contactos de Bart Jerseys, que es un cliente distinto.
--
-- Lo que se conserva: el equipo interno sigue viendo TODOS los perfiles (medio
-- CRM asume poder resolver un nombre por id: responsables, autores, avatares).
-- Lo que cambia: quien es de fuera ve al equipo de casa —necesita saber quién le
-- atiende y quién le escribió— y a sus propios compañeros de empresa. Nada más.
--
-- Va por COLUMNAS de la fila (`rol`, `empresa_id`) y no por una función que
-- vuelva a consultar `profiles`: es más rápido y evita darle vueltas a la RLS de
-- la propia tabla.
--
-- OJO: la RLS filtra FILAS, no columnas. Un externo verá el `rol` y el `area` de
-- los internos que sí puede leer. Es información de trabajo (con quién habla y
-- de qué área es), no un secreto; cerrar columnas exige el aparato de revoke +
-- vista de 20260902000000_dinero_cierre_base.sql y aquí no se justifica.
drop policy if exists "perfiles: leer (autenticados)" on public.profiles;
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
        rol <> 'externo'                            -- el equipo que le atiende
        or empresa_id = (select public.mi_empresa()) -- sus propios compañeros
      )
    )
  );

-- El nombre y el color de SU empresa: es lo que pinta la cabecera del portal.
-- Los contratos y lo que se le cobra siguen cerrados (`agencia_contratos`,
-- `agencia_ingresos` piden `es_administrativo()`), que es lo sensible de un
-- cliente. Policy aparte y solo de lectura: las policies se suman (OR), así que
-- esto no le quita nada a administración ni al equipo interno.
drop policy if exists "agencia_empresas: leer (externo su empresa)" on public.agencia_empresas;
create policy "agencia_empresas: leer (externo su empresa)" on public.agencia_empresas
  for select to authenticated
  using ((select public.es_externo()) and id = (select public.mi_empresa()));

-- ---------------------------------------------------------------------------
-- 5) `actividad_empresas` — el registro que no se toca
-- ---------------------------------------------------------------------------
-- Este módulo no es solo organización: es evidencia. Cuando dentro de seis meses
-- se discuta si se pidió la constancia fiscal, cuándo se pidió y si se entregó,
-- esta tabla es la que cierra la conversación. Por eso no se puede editar ni
-- borrar — tampoco por dirección, que es quien tendría el motivo.
--
-- El nombre del actor se congela ADEMÁS de la referencia: si la cuenta se da de
-- baja, el registro tiene que seguir diciendo quién hizo qué. Una FK que apunta
-- a un perfil borrado es un renglón que dice «alguien».
create table if not exists public.actividad_empresas (
  id           bigint generated always as identity primary key,
  empresa_id   uuid references public.agencia_empresas(id) on delete set null,
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_nombre text,                       -- congelado: sobrevive a la baja
  -- Qué pasó, con el vocabulario de lib/actividad.ts: 'tarea_creada',
  -- 'tarea_estado', 'documento_descargado', 'visibilidad_cambiada', 'login'…
  accion       text not null,
  entidad      text,                       -- 'tarea' | 'documento' | 'bitacora'…
  entidad_id   uuid,
  detalle      jsonb,                      -- el antes/después, o lo que aplique
  created_at   timestamptz not null default now()
);

comment on table public.actividad_empresas is
  'Registro append-only del módulo de empresas: quién, qué y cuándo. Es evidencia, no una bitácora de conveniencia: no admite UPDATE ni DELETE (ni para dirección) y NO entra en purgar_logs (20260830000000). Para un borrado legítimo e irrepetible habría que desactivar a mano el trigger actividad_empresas_inmutable, y eso debe quedar por escrito.';

create index if not exists actividad_empresas_empresa_idx
  on public.actividad_empresas(empresa_id, created_at desc);
create index if not exists actividad_empresas_actor_idx
  on public.actividad_empresas(actor_id, created_at desc);
create index if not exists actividad_empresas_entidad_idx
  on public.actividad_empresas(entidad, entidad_id);

-- El candado de verdad. Un `revoke` se puede volver a otorgar y una policy que
-- falta se puede crear: el trigger es lo que hace que una escritura equivocada
-- —o deliberada— reviente en vez de pasar en silencio. Cubre también al
-- service_role, que es la llave con la que corren los crons y los scripts.
create or replace function public.actividad_empresas_inmutable()
returns trigger language plpgsql as $$
begin
  raise exception 'El registro de actividad es evidencia: no se edita ni se borra (%).', tg_op;
end;
$$;

drop trigger if exists actividad_empresas_inmutable on public.actividad_empresas;
create trigger actividad_empresas_inmutable
  before update or delete on public.actividad_empresas
  for each row execute function public.actividad_empresas_inmutable();

alter table public.actividad_empresas enable row level security;

-- El grant ancho de 20250101000001_rls.sql solo alcanzó a las tablas que
-- existían entonces; esta se abre a mano, y solo a lo que necesita.
grant select, insert on public.actividad_empresas to authenticated;
grant all    on public.actividad_empresas to service_role;
revoke update, delete on public.actividad_empresas from authenticated, anon;

-- Escribe cualquiera con sesión, pero solo a su propio nombre: una acción no se
-- le puede atribuir a otro. Los triggers de las fases siguientes son SECURITY
-- DEFINER y entran por encima de la RLS, así que esto no les estorba.
drop policy if exists "actividad: registrar (a nombre propio)" on public.actividad_empresas;
create policy "actividad: registrar (a nombre propio)" on public.actividad_empresas
  for insert to authenticated
  with check (actor_id = (select auth.uid()));

-- Leerlo es otra cosa: es el expediente de todos, incluido el equipo. Dirección.
drop policy if exists "actividad: leer (direccion)" on public.actividad_empresas;
create policy "actividad: leer (direccion)" on public.actividad_empresas
  for select to authenticated
  using ((select public.es_admin(auth.uid())));

-- Sin policies de UPDATE ni DELETE: la RLS deniega por defecto. Son tres
-- candados sobre la misma puerta (revoke, ausencia de policy, trigger) y es a
-- propósito — cada uno se puede deshacer por accidente, los tres no.

-- ---------------------------------------------------------------------------
-- 6) Autocomprobación: que el registro aguante lo que promete
-- ---------------------------------------------------------------------------
-- Se inserta una fila de prueba, se intenta borrarla y actualizarla, y se espera
-- que AMBAS cosas fallen. Todo dentro de una subtransacción que se revierte, así
-- que la tabla queda como estaba.
do $$
declare
  v_id       bigint;
  v_actor    uuid;
  v_borro    boolean := false;
  v_edito    boolean := false;
  v_error    text;
begin
  select id into v_actor from public.profiles where rol = 'direccion' order by nombre limit 1;

  begin
    insert into public.actividad_empresas (actor_id, actor_nombre, accion, detalle)
      values (v_actor, 'prueba de la migración 20260914', 'prueba', '{"prueba":true}'::jsonb)
      returning id into v_id;

    begin
      delete from public.actividad_empresas where id = v_id;
      v_borro := true;
    exception when others then
      v_borro := false;
    end;

    begin
      update public.actividad_empresas set accion = 'manipulada' where id = v_id;
      v_edito := true;
    exception when others then
      v_edito := false;
    end;

    -- Deshacer: lanzar y capturar revierte esta subtransacción entera.
    raise exception 'ok_deshacer';
  exception
    when others then
      v_error := sqlerrm;
  end;

  if v_error is distinct from 'ok_deshacer' then
    raise exception 'No se pudo ni registrar una fila de actividad: %', v_error;
  end if;
  if v_borro then
    raise exception 'El registro de actividad SE PUDO BORRAR: el trigger no está haciendo su trabajo.';
  end if;
  if v_edito then
    raise exception 'El registro de actividad SE PUDO EDITAR: el trigger no está haciendo su trabajo.';
  end if;

  raise notice 'OK — la actividad se escribe, y no se deja borrar ni editar.';
end $$;

-- Y que las dos guardas de `profiles` quedaran puestas. No se prueban con un
-- INSERT: `profiles.id` referencia a `auth.users`, así que un alta inventada
-- fallaría por la llave foránea y la prueba diría «bien» sin haber probado nada.
-- Se comprueba contra el catálogo, que es lo que de verdad rige.
do $$
declare
  v_faltan text[] := '{}';
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.profiles'::regclass
                    and conname = 'profiles_externo_empresa_check') then
    v_faltan := v_faltan || 'profiles_externo_empresa_check';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.profiles'::regclass
                    and conname = 'profiles_rol_portal_check') then
    v_faltan := v_faltan || 'profiles_rol_portal_check';
  end if;

  if array_length(v_faltan, 1) is not null then
    raise exception 'Faltan las guardas de profiles: %', array_to_string(v_faltan, ', ');
  end if;
  raise notice 'OK — un externo sin empresa (o un interno con ella) no se puede dar de alta.';
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   -- 1. Nadie tiene empresa todavía; el equipo sigue completo.
--   select nombre, rol, rol_portal, empresa_id from public.profiles order by rol, nombre;
--
--   -- 2. La lectura de perfiles ya no es `true` a secas.
--   select policyname, qual from pg_policies
--    where schemaname='public' and tablename='profiles' and cmd='SELECT';
--
--   -- 3. El alta de un cliente se hace con el script, NO a mano:
--   --    node --env-file=.env.local scripts/crear-usuario.mjs \
--   --      --email contacto@nutravia.mx --nombre "…" --rol externo \
--   --      --empresa nutravia --rol-portal admin_cliente --password "…"
-- ============================================================================
