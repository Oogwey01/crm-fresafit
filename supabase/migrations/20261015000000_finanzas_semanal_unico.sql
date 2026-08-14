-- ============================================================================
-- Gastos fijos personales: lo que pidió Armando por audio el 13/08/2026.
--
--   * periodicidad gana 'semanal' («agrega uno para que tenga más feedback»)
--     y 'unico' («puede ser de una sola vez o recurrente»).
--   * fecha_unica date — la fecha del pago cuando es de una sola vez: el
--     `dia_pago` (1-31) no alcanza porque no dice mes ni año.
--
-- El mensualizado lo calcula la app (lib/finanzas/personales.ts): semanal
-- cuenta ×52/12 y 'unico' no suma al total del mes. Sin cambios de RLS: las
-- policies por owner_id de 20261009000000 cubren las columnas nuevas.
-- Idempotente: correrla dos veces no truena.
-- ============================================================================

alter table public.finanzas_personales
  drop constraint if exists finanzas_personales_periodicidad_check;

alter table public.finanzas_personales
  add constraint finanzas_personales_periodicidad_check
  check (periodicidad in ('unico','semanal','mensual','bimestral','trimestral','semestral','anual'));

alter table public.finanzas_personales
  add column if not exists fecha_unica date;

comment on column public.finanzas_personales.periodicidad is
  'unico = pago de una sola vez (su fecha va en fecha_unica y no suma al mensualizado); el resto son recurrentes.';
comment on column public.finanzas_personales.fecha_unica is
  'Solo para periodicidad = unico: el día exacto del pago.';
