-- ============================================================================
-- 20260820000000_influencers.sql — Programa de influencers y embajadores
-- ----------------------------------------------------------------------------
-- El programa vivía en cuatro hojas sueltas de Drive («Influencers MKT»,
-- «Embajadores FF», las respuestas del formulario de convocatoria y el doc de
-- specs con los tiers). El flujo completo es: llega un prospecto por el
-- formulario → se evalúa → se le asigna tier → se le entrega material → se le
-- evalúa cada mes contra su código y sus entregables.
--
--   * influencers             — la persona, su etapa, su tier y su código.
--   * influencer_entregas     — material que se le mandó (cuadra el crédito mensual).
--   * influencer_evaluaciones — cómo le fue cada mes (una fila por periodo).
--
-- Acceso: SOLO gestores (dirección, administración, coordinación). Maneja
-- comisiones y crédito mensual en producto, así que ni siquiera se lee desde un
-- rol miembro — a diferencia de inventario, que sí es de todo el equipo.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La persona.
--    Los porcentajes y el crédito viven aquí (no solo en el tier) porque en la
--    práctica se negocian caso por caso; en null rigen los valores del tier
--    (TIERS_INFLUENCER en lib/catalogos.ts).
-- ---------------------------------------------------------------------------
create table if not exists public.influencers (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null,
  correo             text,
  celular            text,
  ig_usuario         text,
  ig_seguidores      int check (ig_seguidores >= 0),
  tiktok_usuario     text,
  tiktok_seguidores  int check (tiktok_seguidores >= 0),
  tipo_contenido     text,
  etapa              text not null default 'prospecto'
                       check (etapa in ('prospecto','evaluacion','activo','pausado','rechazado','baja')),
  tier               text check (tier in ('nano','micro','mid','macro','celebrity')),
  codigo             text,                  -- su cupón (MARIOFF10). Vive en TN/ML; aquí solo se registra.
  descuento_pct      numeric(5,2) check (descuento_pct >= 0 and descuento_pct <= 100),
  comision_pct       numeric(5,2) check (comision_pct >= 0 and comision_pct <= 100),
  credito_mensual    numeric(10,2) check (credito_mensual >= 0),
  inicio_prueba      date,                  -- arranque de los 2 meses de prueba
  notas              text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- El código es único sin importar mayúsculas: dos cupones iguales en dos fichas
-- harían imposible atribuir una venta.
create unique index if not exists influencers_codigo_idx
  on public.influencers (upper(codigo)) where codigo is not null;
create index if not exists influencers_etapa_idx on public.influencers(etapa);

-- ---------------------------------------------------------------------------
-- 2. Material entregado (para cuadrar contra el crédito mensual del tier).
-- ---------------------------------------------------------------------------
create table if not exists public.influencer_entregas (
  id             uuid primary key default gen_random_uuid(),
  influencer_id  uuid not null references public.influencers(id) on delete cascade,
  fecha          date not null default current_date,
  producto_id    uuid references public.products(id) on delete set null,
  descripcion    text,                 -- si no está en catálogo (o es un set)
  talla          text,
  cantidad       int not null default 1 check (cantidad > 0),
  valor          numeric(10,2) check (valor >= 0),
  notas          text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists influencer_entregas_persona_idx
  on public.influencer_entregas(influencer_id, fecha desc);

-- ---------------------------------------------------------------------------
-- 3. Evaluación mensual (una fila por persona y periodo).
--    `periodo` es el día 1 del mes: así el único índice evita dos evaluaciones
--    del mismo mes, que es justo lo que pasaba en la hoja.
-- ---------------------------------------------------------------------------
create table if not exists public.influencer_evaluaciones (
  id                  uuid primary key default gen_random_uuid(),
  influencer_id       uuid not null references public.influencers(id) on delete cascade,
  periodo             date not null,
  usos_codigo         int check (usos_codigo >= 0),
  ventas_monto        numeric(12,2) check (ventas_monto >= 0),
  videos              int check (videos >= 0),
  stories             int check (stories >= 0),
  participaciones     int check (participaciones >= 0),
  contenido_organico  boolean not null default false,
  observaciones       text,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (influencer_id, periodo)
);
create index if not exists influencer_eval_periodo_idx
  on public.influencer_evaluaciones(periodo desc);

-- ---------------------------------------------------------------------------
-- 4. `updated_at` de la ficha.
-- ---------------------------------------------------------------------------
create or replace function public.influencers_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists influencers_touch_trg on public.influencers;
create trigger influencers_touch_trg before update on public.influencers
  for each row execute function public.influencers_touch();

-- ---------------------------------------------------------------------------
-- 5. Permisos + RLS: solo gestores, ni siquiera lectura para el resto.
-- ---------------------------------------------------------------------------
grant all on
  public.influencers, public.influencer_entregas, public.influencer_evaluaciones
  to authenticated, service_role;

alter table public.influencers            enable row level security;
alter table public.influencer_entregas    enable row level security;
alter table public.influencer_evaluaciones enable row level security;

drop policy if exists "influencers: ver (gestor)" on public.influencers;
create policy "influencers: ver (gestor)" on public.influencers
  for select to authenticated using (public.es_gestor());
drop policy if exists "influencers: gestionar (gestor)" on public.influencers;
create policy "influencers: gestionar (gestor)" on public.influencers
  for all to authenticated using (public.es_gestor()) with check (public.es_gestor());

drop policy if exists "influencer entregas: ver (gestor)" on public.influencer_entregas;
create policy "influencer entregas: ver (gestor)" on public.influencer_entregas
  for select to authenticated using (public.es_gestor());
drop policy if exists "influencer entregas: gestionar (gestor)" on public.influencer_entregas;
create policy "influencer entregas: gestionar (gestor)" on public.influencer_entregas
  for all to authenticated using (public.es_gestor()) with check (public.es_gestor());

drop policy if exists "influencer evaluaciones: ver (gestor)" on public.influencer_evaluaciones;
create policy "influencer evaluaciones: ver (gestor)" on public.influencer_evaluaciones
  for select to authenticated using (public.es_gestor());
drop policy if exists "influencer evaluaciones: gestionar (gestor)" on public.influencer_evaluaciones;
create policy "influencer evaluaciones: gestionar (gestor)" on public.influencer_evaluaciones
  for all to authenticated using (public.es_gestor()) with check (public.es_gestor());

notify pgrst, 'reload schema';
