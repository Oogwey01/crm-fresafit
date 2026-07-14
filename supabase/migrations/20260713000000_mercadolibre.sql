-- ============================================================================
-- Fresafit CRM — Integración Mercado Libre
-- ----------------------------------------------------------------------------
--   * products: columnas de mapeo a ML. Cada renglón puede quedar vinculado a
--     un item (sin variaciones) o a un (item, variación); un mismo renglón
--     puede estar vinculado a Tienda Nube Y a Mercado Libre (stock unificado).
--   * integraciones: columnas refresh_token/expires_at. El token de ML dura
--     6 horas y el refresh token es de UN SOLO USO (rotación): tenerlos en
--     columnas propias permite renovarlos con compare-and-swap sin arriesgar
--     el resto de `datos` (que guarda resúmenes de sincronización).
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.products add column if not exists meli_item_id text;         -- "MLM123..."
alter table public.products add column if not exists meli_variation_id bigint;  -- null = item sin variaciones

-- Una fila por unidad de ML. coalesce(-1) evita duplicados de items sin
-- variaciones (los NULL serían todos distintos en un unique normal).
create unique index if not exists products_meli_uidx
  on public.products (meli_item_id, coalesce(meli_variation_id, -1))
  where meli_item_id is not null;
create index if not exists products_meli_item_idx on public.products(meli_item_id);

alter table public.integraciones add column if not exists refresh_token text;
alter table public.integraciones add column if not exists expires_at timestamptz;

notify pgrst, 'reload schema';
