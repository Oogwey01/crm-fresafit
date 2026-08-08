-- ============================================================================
-- 20260921000000_maquila_config.sql
--   La hora de corte y qué cuenta como día hábil — configurable, no hardcodeado.
-- ----------------------------------------------------------------------------
-- La spec de Armando lo pide con todas sus letras: la hora límite de corte "se
-- va a ajustar con la experiencia real", así que no puede vivir en el código.
-- Un pedido de bordado pagado el lunes a las 9:00 entra al corte de ese lunes;
-- pagado a las 14:00 (después de la hora límite) cuenta desde el siguiente día
-- hábil y cae al corte del jueves.
--
-- `sabado_habil` existe porque la spec solo excluye domingos y festivos
-- explícitamente; si el taller de Eduardo no trabaja sábados, se apaga aquí y
-- todas las promesas se recalculan solas para los pedidos nuevos.
--
-- Es un singleton (una sola fila, id=1) igual que el resto de configuración
-- puntual: más simple que una tabla llave-valor y el CHECK impide que alguien
-- meta una segunda fila por accidente.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.maquila_config (
  id           int primary key check (id = 1),
  -- Hora de México (America/Mexico_City): a partir de esta hora, el pago
  -- cuenta como del siguiente día hábil.
  hora_limite  time not null default '13:00',
  sabado_habil boolean not null default true,
  updated_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now()
);

comment on table public.maquila_config is
  'Configuración del módulo Maquila México (singleton, id=1): hora límite de corte y si el sábado cuenta como hábil. La lee la ingesta al calcular fechas prometidas.';

insert into public.maquila_config (id) values (1)
  on conflict (id) do nothing;

drop trigger if exists maquila_config_touch_trg on public.maquila_config;
create trigger maquila_config_touch_trg
  before update on public.maquila_config
  for each row execute function public.maquila_touch();

-- ---------------------------------------------------------------------------
-- Permisos + RLS: la ve todo el equipo (el tablero explica sus fechas con
-- ella); la cambia administración. Eduardo no la necesita: sus pedidos ya
-- llegan con la fecha calculada.
-- ---------------------------------------------------------------------------
grant all on public.maquila_config to authenticated, service_role;

alter table public.maquila_config enable row level security;

drop policy if exists "maquila config: ver (interno)" on public.maquila_config;
create policy "maquila config: ver (interno)" on public.maquila_config
  for select to authenticated using ((select public.es_interno()));

drop policy if exists "maquila config: actualizar (admin)" on public.maquila_config;
create policy "maquila config: actualizar (admin)" on public.maquila_config
  for update to authenticated
  using ((select public.es_administrativo()))
  with check ((select public.es_administrativo()));

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select * from public.maquila_config;
--
-- Debe salir UNA fila: id=1, hora_limite 13:00, sabado_habil true.
-- ============================================================================
