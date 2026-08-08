-- ============================================================================
-- 20260922000000_maquila_festivos.sql
--   Los días que NO cuentan para la promesa: festivos de ley y cierres del taller.
-- ----------------------------------------------------------------------------
-- La fecha prometida al cliente se calcula en días hábiles, y "hábil" tiene
-- dos excepciones que el código no puede adivinar: los festivos oficiales de
-- México (art. 74 de la Ley Federal del Trabajo) y los días en que el taller
-- de Eduardo cierra (vacaciones, imprevistos). Un festivo mal contado es una
-- promesa incumplida sin que nadie haya hecho nada mal — por eso es un
-- criterio de aceptación del módulo y por eso va en tabla configurable, no en
-- una lista hardcodeada.
--
-- Un día por fila. Los cierres largos (una semana de vacaciones) se capturan
-- como rango desde la UI, que inserta N filas: así el cálculo de fechas es un
-- solo `select fecha` sin lógica de intervalos.
--
-- Se siembran los festivos de ley 2026–2027 (los de fecha variable ya
-- resueltos a su lunes correspondiente). El 1 de octubre sexenal no toca
-- hasta 2030. `on conflict do nothing`: si alguien ya capturó uno, se respeta.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.maquila_festivos (
  fecha      date primary key,
  tipo       text not null default 'festivo' check (tipo in ('festivo','cierre')),
  motivo     text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.maquila_festivos is
  'Días NO hábiles para el cálculo de fechas prometidas de maquila: festivos oficiales MX y cierres del taller de Eduardo. Un día por fila.';

insert into public.maquila_festivos (fecha, tipo, motivo) values
  ('2026-01-01', 'festivo', 'Año Nuevo'),
  ('2026-02-02', 'festivo', 'Día de la Constitución (primer lunes de febrero)'),
  ('2026-03-16', 'festivo', 'Natalicio de Benito Juárez (tercer lunes de marzo)'),
  ('2026-05-01', 'festivo', 'Día del Trabajo'),
  ('2026-09-16', 'festivo', 'Día de la Independencia'),
  ('2026-11-16', 'festivo', 'Revolución Mexicana (tercer lunes de noviembre)'),
  ('2026-12-25', 'festivo', 'Navidad'),
  ('2027-01-01', 'festivo', 'Año Nuevo'),
  ('2027-02-01', 'festivo', 'Día de la Constitución (primer lunes de febrero)'),
  ('2027-03-15', 'festivo', 'Natalicio de Benito Juárez (tercer lunes de marzo)'),
  ('2027-05-01', 'festivo', 'Día del Trabajo'),
  ('2027-09-16', 'festivo', 'Día de la Independencia'),
  ('2027-11-15', 'festivo', 'Revolución Mexicana (tercer lunes de noviembre)'),
  ('2027-12-25', 'festivo', 'Navidad')
on conflict (fecha) do nothing;

-- ---------------------------------------------------------------------------
-- Permisos + RLS: los ve todo el equipo; los captura administración (los
-- cierres del taller los avisa Eduardo, pero los registra quien coordina).
-- ---------------------------------------------------------------------------
grant all on public.maquila_festivos to authenticated, service_role;

alter table public.maquila_festivos enable row level security;

drop policy if exists "maquila festivos: ver (interno)" on public.maquila_festivos;
create policy "maquila festivos: ver (interno)" on public.maquila_festivos
  for select to authenticated using ((select public.es_interno()));

drop policy if exists "maquila festivos: gestionar (admin)" on public.maquila_festivos;
create policy "maquila festivos: gestionar (admin)" on public.maquila_festivos
  for all to authenticated
  using ((select public.es_administrativo()))
  with check ((select public.es_administrativo()));

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select fecha, motivo from public.maquila_festivos order by fecha;
--
-- Deben salir 14 festivos (7 de 2026, 7 de 2027) y ningún cierre todavía.
-- ============================================================================
