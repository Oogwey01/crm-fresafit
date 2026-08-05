-- ============================================================================
-- Fresafit CRM — Separar el inventario de TikTok del de bodega
-- ----------------------------------------------------------------------------
-- Hasta ahora, cuando un SKU de TikTok coincidía con el de una ficha que
-- también vive en Tienda Nube/Mercado Libre, la sync VINCULABA esa misma
-- ficha de bodega a TikTok (una sola fila para los dos canales). Confirmado
-- con datos reales que esto está mal para este negocio: TikTok tiene su
-- PROPIO inventario, distinto al de bodega (ej. SBD019 "Rick and Morty":
-- 73/72/0/0 en TikTok Seller Center contra 53/54/0/0 en la bodega — números
-- genuinamente distintos, no el mismo stock contado dos veces).
--
-- El código de la sync ya se corrigió (lib/tiktok/sync.ts) para que, de aquí
-- en adelante, TikTok SIEMPRE reciba su propia ficha delegada —nunca adopte
-- una de bodega— aunque comparta SKU con un producto que también se vende en
-- Tienda Nube/Mercado Libre.
--
-- Pero eso solo aplica a partir de la primera corrida con el código nuevo:
-- las fichas de bodega que YA tienen vínculo de TikTok desde antes (~342,
-- de un vínculo directo mucho más viejo, de cuando se conectó TikTok por
-- primera vez) se van a quedar así para siempre si no se desvinculan aquí:
-- el código nuevo no las va a tocar solo porque exista un tiktok_sku_id.
--
-- Esta migración:
--   1. Borra la publicación de `tiktok_publicaciones` que hoy apunta a esas
--      fichas de bodega (para que `yaMapeadas` no las siga saltando en la sync).
--   2. Limpia tiktok_product_id / tiktok_sku_id / tiktok_stock de esas fichas
--      de bodega: quedan como productos SOLO de Tienda Nube/Mercado Libre,
--      igual que antes de que TikTok existiera para el CRM.
--
-- Después de correr esto, la SIGUIENTE sync (/api/tiktok/sync) va a ver esos
-- SKUs de TikTok como publicaciones nuevas y les va a crear su propia ficha
-- delegada, con su propio nombre/fotos/precio/stock — sin tocar la ficha de
-- bodega, que sigue exactamente igual que está hoy.
--
-- OJO — deuda ya conocida y aceptada (no se resuelve aquí): las ventas de
-- TikTok que ya se importaron para estos SKUs quedaron con `sales.producto_id`
-- apuntando a la ficha de bodega (la única que existía en ese momento). Esta
-- migración no las retoca; las ventas NUEVAS, después de la siguiente sync, sí
-- se van a atribuir correctamente a la ficha nueva de TikTok.
--
-- Idempotente: si ya no queda ninguna ficha de bodega con tiktok_sku_id, no
-- hace nada.
--
-- Renombrado, no reescrito: este archivo era
-- 20260809000000_tiktok_desvincular_bodega.sql y compartía versión con
-- 20260809000000_rastreo_pedidos.sql. El CLI de Supabase usa ese prefijo como
-- clave única en schema_migrations, así que se le movió a ...000100 para
-- deshacer la colisión. El contenido es el mismo y sigue corriendo justo donde
-- corría: después de la otra migración del mismo día y después de
-- 20260808000100_tiktok_stock.sql, que crea la columna `tiktok_stock` que aquí
-- se limpia.
-- ============================================================================

-- Diagnóstico — revisar antes de correr el resto: cuántas fichas se van a
-- desvincular y con qué números se quedan (bodega) vs. lo que traía TikTok.
select id, nombre, sku, stock as stock_bodega, tiktok_stock, tiktok_product_id, tiktok_sku_id,
       tiendanube_variant_id, meli_item_id
  from public.products
 where tiktok_sku_id is not null
   and (tiendanube_variant_id is not null or meli_item_id is not null)
 order by nombre;

-- Paso 1 — limpia el mapa de publicaciones que hoy apunta a estas fichas.
delete from public.tiktok_publicaciones
 where producto_id in (
   select id from public.products
    where tiktok_sku_id is not null
      and (tiendanube_variant_id is not null or meli_item_id is not null)
 );

-- Paso 2 — desvincula las fichas de bodega.
update public.products
   set tiktok_product_id = null,
       tiktok_sku_id = null,
       tiktok_stock = null
 where tiktok_sku_id is not null
   and (tiendanube_variant_id is not null or meli_item_id is not null);
