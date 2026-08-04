-- ============================================================================
-- Fresafit CRM — El inventario que TikTok reporta, como número aparte
-- ----------------------------------------------------------------------------
-- Mismo patrón que meli_stock_full (20260801000000_meli_stock_full.sql):
-- cuando una ficha TAMBIÉN vive en Tienda Nube o Mercado Libre, `stock` es el
-- de la bodega (así evita repetir el incidente de MQR004, donde la sync dejó
-- el stock de TikTok pisando al real). Pero eso hacía que el número que
-- TikTok reporta para su propia publicación se descartara sin guardarse en
-- ningún lado — invisible en el CRM aunque sea información real y distinta a
-- la de bodega.
--
-- Con esta columna los dos números conviven: `stock` sigue siendo la bodega
-- (o el propio inventario delegado, si la ficha es solo de TikTok) y
-- `tiktok_stock` es lo que TikTok reporta para esa publicación en concreto.
-- La sincronización de TikTok la llena en cada corrida, incluso para fichas
-- multicanal (antes ahí no hacía nada). null = sin dato propio de TikTok
-- todavía, o ficha sin publicación de TikTok.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.products
  add column if not exists tiktok_stock int;

comment on column public.products.tiktok_stock is
  'Unidades que TikTok Shop reporta para esta publicación. Aparte de `stock`: en una ficha multicanal, `stock` lo gobierna la bodega (Tienda Nube/Mercado Libre) y esto es lo que TikTok tiene guardado para su propia publicación, independiente. null = sin dato propio todavía. Lo escribe la sincronización de TikTok.';
