-- ============================================================================
-- 20261009000000_finanzas_personales.sql
--   Los pagos fijos personales de cada quien, dentro de /finanzas.
-- ----------------------------------------------------------------------------
-- QUÉ ES. Un renglón por compromiso que se repite: la luz (que en México llega
-- cada dos meses), el internet, el plan de Telcel, la suscripción de turno. No
-- es un registro de pagos hechos —eso son `expenses`, y son del negocio— sino
-- la lista de lo que se debe cada mes aunque el recibo todavía no llegue. Por
-- eso lo que se guarda es el COMPROMISO (monto + cada cuándo) y no el
-- movimiento.
--
-- POR QUÉ UNA TABLA APARTE Y NO UNA CATEGORÍA MÁS DE `expenses`. Porque la
-- pregunta de acceso es la contraria. `expenses` la ven dirección Y
-- administración enteras (policy «gastos: administracion», 20260819000000): es
-- el dinero de la empresa y hay dos personas que lo llevan. Esto es el dinero
-- de UNA persona, y no lo ve nadie más —ni una dirección mirando lo de otra
-- dirección—. Una categoría "personal" dentro de `expenses` habría quedado a la
-- vista de administración el mismo día, y de paso habría entrado en los totales
-- del negocio: «Salidas», «Gastos por categoría», /metricas y /reportes leen
-- esa tabla. El recibo de la luz de su casa no es un egreso de Fresafit y no
-- puede mover ni un peso de esas pantallas.
--
-- EL CANDADO ES EL DUEÑO, NO EL ROL. Las cuatro policies dicen lo mismo y solo
-- eso: `owner_id = (select auth.uid())`. NO hay una rama `or es_admin(...)` y
-- no la puede haber: las policies de Postgres se SUMAN (OR), así que una sola
-- rama de rol abriría la tabla entera a quien la cumpla. La pestaña de la app
-- se pinta solo para dirección, pero eso es cortesía de interfaz para no
-- ofrecerle a administración un botón que le va a devolver vacío; el candado
-- de verdad es éste.
--
-- El `(select ...)` alrededor de auth.uid() no es adorno: lo convierte en un
-- InitPlan que Postgres resuelve UNA vez por consulta en lugar de una por fila
-- (se midió 35× en 20260824000000).
--
-- NO SE SIEMBRA NADA. La tabla nace vacía a propósito: la llena su dueño desde
-- /finanzas. Un insert de ejemplo aquí, además de mentir, sería imposible de
-- atribuir —en el SQL Editor `auth.uid()` es null y el not-null lo rebota—.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.finanzas_personales (
  id           uuid primary key default gen_random_uuid(),

  -- El dueño, y la única llave de esta tabla. El `default auth.uid()` es para
  -- que un renglón no pueda nacer ajeno ni huérfano aunque algún día alguien
  -- escriba el insert sin la columna; la RLS lo vuelve a exigir en el `with
  -- check`.
  owner_id     uuid not null default auth.uid()
               references public.profiles(id) on delete cascade,

  concepto     text not null,

  -- Lo que se paga EN CADA COBRO, no al mes: repartirlo es cuenta de la app.
  monto        numeric(12,2) not null default 0 check (monto >= 0),

  -- Cada cuánto llega el cobro. Texto + check y no un tipo enum: el día que
  -- haga falta "cuatrimestral" es cambiar una línea, no migrar un tipo con
  -- todas sus vistas colgando. La bimestral está porque la luz en México es
  -- bimestral, y es justo el caso que rompe cualquier lista de «mensual/anual».
  periodicidad text not null default 'mensual'
               check (periodicidad in ('mensual','bimestral','trimestral','semestral','anual')),

  -- Día del mes en que se paga. Nulo = todavía no se sabe, que es un estado
  -- legítimo: se captura el monto hoy y la fecha cuando llegue el recibo.
  dia_pago     int check (dia_pago between 1 and 31),

  categoria    text not null default 'otro'
               check (categoria in ('hogar','servicios','conectividad','suscripciones',
                                    'transporte','salud','creditos','otro')),

  -- Dar de baja sin borrar: cancelar una suscripción no debe obligar a perder
  -- el renglón y su historia. Lo dado de baja deja de sumar al «cuánto me
  -- cuesta el mes» y se pinta atenuado.
  activo       boolean not null default true,

  notas        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Un renglón sin concepto no se puede reconocer un mes después.
  constraint finanzas_personales_concepto_no_vacio check (btrim(concepto) <> '')
);

comment on table public.finanzas_personales is
  'Compromisos fijos personales de cada usuario (luz, internet, celular, suscripciones). PRIVADA: la RLS la acota al dueño y nadie más entra, tampoco dirección. Nada que ver con `expenses`, que son los gastos de Fresafit.';

comment on column public.finanzas_personales.owner_id is
  'De quién es este renglón. Es la única llave de acceso: las cuatro policies son owner_id = auth.uid().';
comment on column public.finanzas_personales.monto is
  'Lo que se paga EN CADA COBRO, no al mes. La normalización a mensual la hace la app (lib/finanzas/personales.ts): un recibo bimestral de $1,800 cuesta $900 al mes.';
comment on column public.finanzas_personales.periodicidad is
  'Cada cuántos meses llega el cobro: mensual=1, bimestral=2, trimestral=3, semestral=6, anual=12.';
comment on column public.finanzas_personales.dia_pago is
  'Día del mes en que toca pagar (1-31). Null = aún no se sabe. Ojo: para lo que no es mensual dice el DÍA pero no el MES, así que la app solo promete fecha exacta en los mensuales.';
comment on column public.finanzas_personales.activo is
  'false = dado de baja. Se conserva el renglón pero deja de contar en el total mensual.';

-- Único camino de acceso a la tabla: TODA lectura pasa por el owner_id que
-- impone la RLS, así que el índice es exactamente el predicado.
create index if not exists finanzas_personales_owner_idx
  on public.finanzas_personales (owner_id, activo);

drop trigger if exists finanzas_personales_touch on public.finanzas_personales;
create trigger finanzas_personales_touch
  before update on public.finanzas_personales
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Permisos y RLS. El grant va ANTES de encender RLS (orden de la casa).
-- ---------------------------------------------------------------------------
grant all on public.finanzas_personales to authenticated, service_role;

-- `anon` no toca esto ni de lejos. Y TRUNCATE se le quita también a
-- `authenticated`: es la única operación que NO pasa por las policies (ver la
-- cabecera de 20260829000000_higiene.sql). En una tabla que es la copia única
-- de las cuentas privadas de alguien, esa excepción no se deja abierta.
revoke all on public.finanzas_personales from anon;
revoke truncate on public.finanzas_personales from authenticated;

alter table public.finanzas_personales enable row level security;

-- Las cuatro operaciones, las cuatro por dueño. Separadas y no un `for all`
-- para que se lea de un vistazo que ninguna tiene una salida por rol.
drop policy if exists "finanzas personales: ver (dueño)" on public.finanzas_personales;
create policy "finanzas personales: ver (dueño)" on public.finanzas_personales
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "finanzas personales: crear (dueño)" on public.finanzas_personales;
create policy "finanzas personales: crear (dueño)" on public.finanzas_personales
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- El `using` impide editar lo ajeno; el `with check` impide además REGALAR o
-- APROPIARSE de un renglón cambiándole el dueño. Sin el segundo, quien pudiera
-- escribir podría mover una fila a otro owner_id y sacarla de su propia vista.
drop policy if exists "finanzas personales: editar (dueño)" on public.finanzas_personales;
create policy "finanzas personales: editar (dueño)" on public.finanzas_personales
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "finanzas personales: borrar (dueño)" on public.finanzas_personales;
create policy "finanzas personales: borrar (dueño)" on public.finanzas_personales
  for delete to authenticated
  using (owner_id = (select auth.uid()));

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   -- 1. Nace vacía, y así se queda hasta que él capture:
--   select count(*) from public.finanzas_personales;                    -- 0
--
--   -- 2. RLS encendida:
--   select relrowsecurity from pg_class
--    where oid = 'public.finanzas_personales'::regclass;                -- true
--
--   -- 3. Las cuatro policies, y NINGUNA con una rama de rol. En las cuatro
--   --    debe leerse solo `owner_id = (select auth.uid())`. Si algún día
--   --    aparece aquí un es_admin/es_administrativo, la tabla quedó abierta:
--   --    las policies se SUMAN.
--   select policyname, cmd, qual, with_check
--     from pg_policies
--    where schemaname = 'public' and tablename = 'finanzas_personales'
--    order by cmd;                                                      -- 4 filas
--
--   -- 4. anon sin nada, authenticated sin TRUNCATE:
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'finanzas_personales' order by grantee, privilege_type;
--
--   -- 5. LA PRUEBA DE FUEGO va en la app, con dos sesiones: quien capture ve
--   --    sus renglones; administración no ve ni la pestaña; OTRA dirección ve
--   --    la pestaña VACÍA. Eso último es lo que prueba que la RLS cierra.
--
--   -- 6. SI ALGÚN DÍA SE LE CREA UN USUARIO NUEVO (no si solo se le edita el
--   --    correo al de siempre: ahí el uuid no se mueve y no hay nada que
--   --    hacer), sus renglones se quedan con el dueño viejo y desaparecen para
--   --    todos, él incluido. Se reasignan desde aquí:
--   --      update public.finanzas_personales
--   --         set owner_id = '<uuid nuevo>'
--   --       where owner_id = '<uuid viejo>';
--
-- DESPUÉS de aplicar esto hay que regenerar los tipos, o el typecheck no
-- conocerá la tabla:
--
--       pnpm gen:types
-- ============================================================================
