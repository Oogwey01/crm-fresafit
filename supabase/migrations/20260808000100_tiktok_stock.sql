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
--
-- Renombrado, no reescrito: este archivo era 20260808000000_tiktok_stock.sql y
-- compartía versión con 20260808000000_refresco_direccion.sql. El CLI de
-- Supabase usa ese prefijo como clave única en schema_migrations, así que se le
-- movió a ...000100 para deshacer la colisión. El contenido es el mismo y sigue
-- corriendo justo donde corría: después de la otra migración del mismo día, y
-- antes de 20260809000100_tiktok_desvincular_bodega.sql, que limpia la columna
-- `tiktok_stock` que aquí se crea.
-- ============================================================================

alter table public.products
  add column if not exists tiktok_stock int;

comment on column public.products.tiktok_stock is
  'Unidades que TikTok Shop reporta para esta publicación. Aparte de `stock`: en una ficha multicanal, `stock` lo gobierna la bodega (Tienda Nube/Mercado Libre) y esto es lo que TikTok tiene guardado para su propia publicación, independiente. null = sin dato propio todavía. Lo escribe la sincronización de TikTok.';
