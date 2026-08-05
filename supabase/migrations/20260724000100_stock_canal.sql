-- ============================================================================
-- Fresafit CRM — Foto periódica del stock en cada canal
-- ----------------------------------------------------------------------------
-- `stock_log` responde "qué cambió en el CRM y por qué", pero solo ve lo que
-- hace el CRM. No ve los cambios de otros: Astroselling, los ajustes que el
-- equipo hace en el panel de Tienda Nube, ni el descuento que cada canal aplica
-- al vender. Ese punto ciego es justo lo que impidió explicar a tiempo el
-- "+27 unidades" del 18/07, cuando el CRM devolvió a Tienda Nube un stock de
-- tres días antes y borró tres movimientos legítimos.
--
-- Esto lo cierra: un cron horario lee el stock EN VIVO de los tres lados y lo
-- guarda. Dos tablas, cada una con un trabajo:
--
--   stock_canal      → último valor observado por producto (una fila por
--                      producto, se pisa en cada corrida). Lectura barata del
--                      "cómo está todo ahora mismo".
--   stock_canal_log  → solo los CAMBIOS. Si entre una foto y la siguiente algún
--                      número se movió, queda el renglón con el antes y el
--                      después de los tres canales. Es la serie histórica, y al
--                      guardar solo diferencias no crece sin control.
--
-- Sirve antes y después de apagar Astroselling: mientras haya otro escritor,
-- delata sus movimientos; cuando el CRM sea el único, avisa si alguien más
-- toca el inventario por fuera.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
--
-- Renombrado, no reescrito: este archivo era 20260724000000_stock_canal.sql y
-- compartía versión con 20260724000000_bajo_pedido.sql. El CLI de Supabase usa
-- ese prefijo como clave única en schema_migrations, así que se le movió a
-- ...000100 para deshacer la colisión. El contenido es el mismo y sigue corriendo
-- justo donde corría: después de la otra migración del mismo día.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Último valor observado (una fila por producto)
-- ----------------------------------------------------------------------------
create table if not exists public.stock_canal (
  producto_id uuid primary key references public.products(id) on delete cascade,
  stock_crm   int,          -- lo que dice `products.stock`
  stock_tn    int,          -- null = no vinculado a TN, sin control de stock o ausente
  stock_ml    int,          -- null = no vinculado a ML, en Mercado Full o ausente
  visto_en    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Cambios detectados entre una foto y la siguiente
-- ----------------------------------------------------------------------------
create table if not exists public.stock_canal_log (
  id              bigint generated always as identity primary key,
  producto_id     uuid references public.products(id) on delete set null,
  stock_crm_ant   int,
  stock_crm       int,
  stock_tn_ant    int,
  stock_tn        int,
  stock_ml_ant    int,
  stock_ml        int,
  detectado_en    timestamptz not null default now()
);

create index if not exists stock_canal_log_producto_idx
  on public.stock_canal_log(producto_id, detectado_en desc);
create index if not exists stock_canal_log_fecha_idx
  on public.stock_canal_log(detectado_en desc);

grant all on public.stock_canal, public.stock_canal_log to authenticated, service_role;
alter table public.stock_canal enable row level security;
alter table public.stock_canal_log enable row level security;

-- Solo lectura para el equipo interno: quien escribe es el cron (service_role).
drop policy if exists "stock canal: ver (interno)" on public.stock_canal;
create policy "stock canal: ver (interno)" on public.stock_canal
  for select to authenticated using (public.es_interno());

drop policy if exists "stock canal log: ver (interno)" on public.stock_canal_log;
create policy "stock canal log: ver (interno)" on public.stock_canal_log
  for select to authenticated using (public.es_interno());

notify pgrst, 'reload schema';
