-- ============================================================================
-- Fresafit CRM — TikTok Shop: catálogo/stock + ventas (3er canal del hub)
-- ----------------------------------------------------------------------------
-- Espejo de las columnas de Tienda Nube y Mercado Libre. Cada SKU de TikTok es
-- un renglón de `products`, mapeado por (tiktok_product_id, tiktok_sku_id).
-- El comprador se identifica por su id de TikTok (PII restringida, como ML).
-- La conexión (token + shop_cipher + warehouse) vive en `integraciones`
-- (id = 'tiktok'), no aquí.
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- Catálogo: vínculo de cada renglón con su publicación/SKU de TikTok.
alter table public.products add column if not exists tiktok_product_id text;
alter table public.products add column if not exists tiktok_sku_id text;

-- Un renglón por SKU de TikTok: índice único parcial (no estorba a los que no
-- vienen de TikTok, cuyos valores son NULL).
create unique index if not exists products_tiktok_sku_uidx
  on public.products(tiktok_sku_id)
  where tiktok_sku_id is not null;
create index if not exists products_tiktok_product_idx
  on public.products(tiktok_product_id)
  where tiktok_product_id is not null;

-- Clientes: identidad del comprador de TikTok (para el historial de compras).
-- Índice único NO parcial: PostgREST solo infiere el ON CONFLICT de un upsert
-- con índices completos, y los NULL no chocan entre sí (clientes de otros
-- canales sin buyer_id conviven sin problema). Igual que mercadolibre_buyer_id.
alter table public.customers add column if not exists tiktok_buyer_id text;
create unique index if not exists customers_tiktok_buyer_uidx
  on public.customers(tiktok_buyer_id);

notify pgrst, 'reload schema';
