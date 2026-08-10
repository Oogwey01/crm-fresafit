-- ============================================================================
-- 20260928000000_maquila_anticipos.sql
--   Lo que Fresa Fit le adelanta a Eduardo, y que se va descontando.
-- ----------------------------------------------------------------------------
-- Al arrancar el proyecto de gamuza prensada hay que ponerle dinero por
-- delante para que compre materia prima ("le voy a comprar 50 cinturones como
-- reserva"). Ese adelanto no es un gasto suelto: es saldo a favor que se
-- consume en los cortes quincenales siguientes, hasta que el flujo se sostiene
-- solo y deja de hacer falta.
--
-- `tipo = 'especie'` cubre lo que Armando dice literal: «tiene a favor 20
-- gamuzas». Se guarda el valor acordado en `monto` —que es lo que el corte
-- resta— más la cantidad y la unidad, para poder leerlo como lo piensa él.
--
-- El SALDO no se guarda: se deriva de lo aplicado en los cortes (vista
-- maquila_anticipos_saldo). Guardarlo sería un segundo lugar donde el mismo
-- número puede quedar mal.
--
-- Todo esto es dinero: RLS de administración y punto. Ni el maquilero, ni
-- coordinación.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.maquila_anticipos (
  id                 uuid primary key default gen_random_uuid(),
  fecha              date not null default current_date,
  tipo               text not null default 'transferencia'
                     check (tipo in ('efectivo','transferencia','especie','otro')),
  concepto           text not null,
  -- Lo que el corte resta. En especie, el valor acordado del material.
  monto              numeric(12,2) not null check (monto >= 0),
  especie_cantidad   numeric(12,2),
  especie_unidad     text,
  -- Bucket `maquila`, carpeta anticipos/ (fuera del alcance del maquilero).
  comprobante_path   text,
  comprobante_nombre text,
  notas              text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.maquila_anticipos is
  'Adelantos a Eduardo (dinero o material). Se consumen en los cortes quincenales vía maquila_corte_anticipos; el saldo se deriva, no se guarda.';

create index if not exists maquila_anticipos_fecha_idx      on public.maquila_anticipos (fecha desc, id);
create index if not exists maquila_anticipos_created_by_idx on public.maquila_anticipos (created_by);

drop trigger if exists maquila_anticipos_touch_trg on public.maquila_anticipos;
create trigger maquila_anticipos_touch_trg
  before update on public.maquila_anticipos
  for each row execute function public.maquila_touch();

-- ---------------------------------------------------------------------------
-- Permisos + RLS: administración y nadie más.
-- ---------------------------------------------------------------------------
grant all on public.maquila_anticipos to authenticated, service_role;

alter table public.maquila_anticipos enable row level security;

drop policy if exists "maquila anticipos: ver (admin)" on public.maquila_anticipos;
create policy "maquila anticipos: ver (admin)" on public.maquila_anticipos
  for select to authenticated using ((select public.es_administrativo()));

drop policy if exists "maquila anticipos: gestionar (admin)" on public.maquila_anticipos;
create policy "maquila anticipos: gestionar (admin)" on public.maquila_anticipos
  for all to authenticated
  using ((select public.es_administrativo()))
  with check ((select public.es_administrativo()));

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select policyname from pg_policies where tablename = 'maquila_anticipos';  -- 2
--   -- La vista del saldo la crea 20260929000000, que necesita los cortes.
-- ============================================================================
