-- ============================================================================
-- Fresafit CRM — Deshacer el escondido de publicaciones de TikTok con SKU
-- repetido entre artículos distintos
-- ----------------------------------------------------------------------------
-- La sync (lib/tiktok/sync.ts) trataba TODO SKU repetido entre dos
-- publicaciones de TikTok como "el mismo artículo republicado" y lo escondía
-- como publicación SECUNDARIA (tiktok_publicaciones.principal = false), sin
-- crear ficha ni copiar nombre/stock/fotos. Eso evitaba el incidente del
-- 02/08/2026 (32 renglones fantasma con 328 unidades inventadas), pero
-- también escondía casos donde el SKU se repite por error entre artículos
-- REALMENTE DISTINTOS —el mismo patrón ya documentado como MQR017P en
-- 20260805000000_tiktok_publicaciones.sql (líneas 24-28) y a propósito no
-- fusionado ahí— como los cintos de Powerlifting reportados: de 20
-- publicaciones reales en TikTok Seller Center, solo 2 quedaban visibles.
--
-- El código ya se corrigió para distinguir ambos casos hacia adelante (ver
-- sincronizarProductosTikTok). Pero las publicaciones que YA quedaron
-- registradas como secundarias siguen saltándose todo el matching en cada
-- corrida futura (yaMapeadas las excluye antes de llegar a la lógica nueva),
-- así que hace falta borrarlas para que la siguiente sync las vuelva a
-- evaluar con la lógica corregida: las que de verdad son republicaciones se
-- vuelven a esconder solas, sin daño; las que son artículos distintos esta
-- vez sí crean su propia ficha.
--
-- Paso 1 (solo lectura): revisar ANTES de borrar que son los cintos
-- esperados y no algo inesperado. Paso 2: el DELETE. Ambos pasos son
-- idempotentes — si no queda ninguna fila `principal = false`, no hacen nada.
--
-- Renombrado, no reescrito: este archivo era
-- 20260806000000_tiktok_publicaciones_desescondidas.sql y compartía versión con
-- 20260806000000_tareas_comentarios_novedades.sql. El CLI de Supabase usa ese
-- prefijo como clave única en schema_migrations, así que se le movió a ...000100
-- para deshacer la colisión. El contenido es el mismo y sigue corriendo justo
-- donde corría: después de la otra migración del mismo día.
-- ============================================================================

-- Paso 1 — diagnóstico: revisar el resultado antes de correr el paso 2.
select pub.tiktok_sku_id,
       pub.tiktok_product_id,
       pub.producto_id,
       p.sku,
       p.nombre,
       (p.tiendanube_variant_id is not null) as en_tienda_nube,
       (p.meli_item_id is not null)          as en_mercado_libre,
       pub.creado_en
  from public.tiktok_publicaciones pub
  join public.products p on p.id = pub.producto_id
 where pub.principal = false
 order by pub.creado_en desc;

-- Paso 2 — remediación: borrar las publicaciones secundarias para que la
-- siguiente corrida de /api/tiktok/sync las reevalúe con la lógica corregida.
delete from public.tiktok_publicaciones
 where principal = false;
