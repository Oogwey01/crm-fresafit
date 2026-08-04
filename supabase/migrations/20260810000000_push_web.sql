-- ============================================================================
-- 20260810000000_push_web.sql — Avisos push al escritorio y al celular
-- ----------------------------------------------------------------------------
-- Hasta ahora los avisos vivían solo dentro del CRM: la campana del menú. Sirven
-- si ya estás en la app, que es justo cuando menos falta hacen. Con Web Push el
-- aviso llega aunque el navegador esté cerrado — que es lo que se pidió: "que le
-- llegue una notificación de que se le asignó una tarea".
--
-- Dos piezas:
--   1) `push_subscriptions`: a qué navegadores hay que empujar. Una fila por
--      dispositivo (la laptop y el celular de la misma persona son dos).
--   2) `notifications.push_enviado_at`: marca de despachado, para no mandar el
--      mismo aviso dos veces. Los avisos los crean triggers dentro de Postgres,
--      así que el despachador es un proceso aparte que barre lo pendiente; esta
--      columna es su memoria.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Suscripciones push
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- La URL que da el navegador; es la identidad del dispositivo para el push.
  endpoint     text not null unique,
  -- Claves de cifrado del navegador (el payload viaja cifrado punta a punta).
  p256dh       text not null,
  auth         text not null,
  -- Para que la persona reconozca cuál dispositivo está dando de baja.
  user_agent   text,
  created_at   timestamptz not null default now(),
  -- Último envío correcto: permite podar las que ya no responden.
  ultimo_uso_at timestamptz
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Cada quien gestiona sus propios dispositivos, y nadie ve los de los demás:
-- el endpoint es una credencial (quien lo tiene puede mandarle avisos).
drop policy if exists push_subs_propias_select on public.push_subscriptions;
create policy push_subs_propias_select on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists push_subs_propias_insert on public.push_subscriptions;
create policy push_subs_propias_insert on public.push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists push_subs_propias_update on public.push_subscriptions;
create policy push_subs_propias_update on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_subs_propias_delete on public.push_subscriptions;
create policy push_subs_propias_delete on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2) Marca de despacho en los avisos
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists push_enviado_at timestamptz;

comment on column public.notifications.push_enviado_at is
  'Cuándo se empujó este aviso a los dispositivos. Null = pendiente de despachar.';

-- Índice parcial: el despachador solo pregunta por lo pendiente, que son unas
-- pocas filas entre miles.
create index if not exists notifications_push_pendientes_idx
  on public.notifications (created_at)
  where push_enviado_at is null;

notify pgrst, 'reload schema';
