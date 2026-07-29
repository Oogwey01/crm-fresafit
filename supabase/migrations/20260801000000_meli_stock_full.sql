-- ============================================================================
-- Fresafit CRM — El inventario de Mercado Full, como número aparte
-- ----------------------------------------------------------------------------
-- Mercado Full es OTRO ALMACÉN: sus unidades están en un centro de Mercado
-- Libre, no en la bodega. Hasta ahora `products` tenía un solo campo `stock`,
-- así que una publicación Full solo se podía representar cuando la ficha vivía
-- ÚNICAMENTE en Mercado Libre. Si el producto también estaba en Tienda Nube
-- —que es el caso de las tres publicaciones Full que tenemos— su `stock` era el
-- de la bodega y el depósito de Full no se guardaba en ningún lado: el filtro
-- «Mercado Full» del inventario salía vacío y «Qué pedir» nunca sugería mandar
-- mercancía al centro de ML.
--
-- Con esta columna los dos números conviven: `stock` sigue siendo la bodega y
-- `meli_stock_full` el depósito de Mercado Full. La sincronización de Mercado
-- Libre la llena en cada corrida (null = la ficha no tiene publicación Full).
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.products
  add column if not exists meli_stock_full int;

comment on column public.products.meli_stock_full is
  'Unidades en el centro de Mercado Full. Aparte de `stock` (la bodega): son almacenes distintos. null = la ficha no tiene publicación fulfillment. Lo escribe la sincronización de Mercado Libre.';

-- Las publicaciones gemelas de catálogo comparten depósito (mismo
-- `user_product_id`), así que el número se cuenta UNA vez por ficha: la sync
-- deduplica antes de escribir aquí.
