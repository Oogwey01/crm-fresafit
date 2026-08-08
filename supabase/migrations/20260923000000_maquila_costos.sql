-- ============================================================================
-- 20260923000000_maquila_costos.sql
--   Lo que se le paga a Eduardo por pieza, con historia.
-- ----------------------------------------------------------------------------
-- Cada pedido de maquila guarda un snapshot de su costo (es el único dinero
-- que Eduardo ve: es lo que cobra). Ese snapshot sale de aquí: la tarifa
-- vigente para el modelo+acabado en la fecha del pago.
--
-- Va con `vigente_desde` y no como precio único porque estos costos SE VAN A
-- renegociar conforme suba el volumen (lo dice la spec) y el corte quincenal
-- de la Fase 2 tiene que poder liquidar piezas viejas al costo viejo: se
-- agrega una fila nueva, nunca se edita la anterior. La tarifa de una fecha es
-- la última fila con `vigente_desde <= fecha`.
--
-- Los montos son SIN IVA (el corte quincenal agrega el 16% aparte, y ese IVA
-- es acreditable — control de Diana, Fase 2). Tabla acordada con Eduardo:
-- powerlift 340/340/420, hebilla 240/240/320; bordado+gamuza se iguala al
-- bordado hasta que se pacte otra cosa.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.maquila_costos (
  id            uuid primary key default gen_random_uuid(),
  modelo        text not null check (modelo in ('powerlift','hebilla')),
  acabado       text not null check (acabado in ('prensado','sublimado','bordado','bordado_gamuza')),
  -- Sin IVA. El 16% se agrega al liquidar, no aquí.
  costo         numeric(12,2) not null check (costo >= 0),
  vigente_desde date not null default current_date,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (modelo, acabado, vigente_desde)
);

comment on table public.maquila_costos is
  'Tarifas de maquila por modelo+acabado, sin IVA, con vigencia por fecha. La tarifa de un pedido es la última fila con vigente_desde <= fecha de pago. Solo se agregan filas; no se editan.';

insert into public.maquila_costos (modelo, acabado, costo, vigente_desde) values
  ('powerlift', 'prensado',       340.00, '2026-08-01'),
  ('powerlift', 'sublimado',      340.00, '2026-08-01'),
  ('powerlift', 'bordado',        420.00, '2026-08-01'),
  ('powerlift', 'bordado_gamuza', 420.00, '2026-08-01'),
  ('hebilla',   'prensado',       240.00, '2026-08-01'),
  ('hebilla',   'sublimado',      240.00, '2026-08-01'),
  ('hebilla',   'bordado',        320.00, '2026-08-01'),
  ('hebilla',   'bordado_gamuza', 320.00, '2026-08-01')
on conflict (modelo, acabado, vigente_desde) do nothing;

-- ---------------------------------------------------------------------------
-- Permisos + RLS: ver es del equipo interno (el tablero interno enseña el
-- costo de cada pedido); cambiar tarifas es de dirección — es negociación con
-- un proveedor, el mismo escalón que el módulo Proveedores.
-- ---------------------------------------------------------------------------
grant all on public.maquila_costos to authenticated, service_role;

alter table public.maquila_costos enable row level security;

drop policy if exists "maquila costos: ver (interno)" on public.maquila_costos;
create policy "maquila costos: ver (interno)" on public.maquila_costos
  for select to authenticated using ((select public.es_interno()));

drop policy if exists "maquila costos: gestionar (direccion)" on public.maquila_costos;
create policy "maquila costos: gestionar (direccion)" on public.maquila_costos
  for all to authenticated
  using ((select public.es_admin(auth.uid())))
  with check ((select public.es_admin(auth.uid())));

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select modelo, acabado, costo, vigente_desde
--     from public.maquila_costos order by modelo, acabado;
--
-- Deben salir 8 tarifas con vigencia 2026-08-01.
-- ============================================================================
