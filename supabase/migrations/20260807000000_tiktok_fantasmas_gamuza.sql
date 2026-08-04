-- ============================================================================
-- Fresafit CRM — Limpieza de fichas fantasma creadas por la primera versión
-- del fix de 20260806000000_tiktok_publicaciones_desescondidas.sql
-- ----------------------------------------------------------------------------
-- Esa migración liberó las publicaciones de TikTok que estaban escondidas
-- (principal = false) para que la sync las reevaluara. El código de la sync
-- ya se corrigió para no esconder productos distintos con SKU repetido, pero
-- esa primera versión del chequeo solo miraba si la publicación "dueña" del
-- SKU seguía EXISTIENDO en el catálogo de TikTok (status "ALL"), no si
-- seguía ACTIVA. Como TikTok sigue devolviendo publicaciones desactivadas
-- (no borradas) en ese fetch, la sync del 03/08/2026 volvió a crear fichas
-- fantasma para publicaciones viejas y desactivadas — incluyendo, otra vez,
-- el "Cinturón de Powerlift Gamuza Lavanda" (SBD043) del incidente original
-- del 02/08/2026, con los mismos stocks fantasma 20/20/10/10.
--
-- El código ya quedó corregido para exigir que las DOS publicaciones (la
-- entrante y la que ya tiene la ficha) estén activas a la vez, no solo que
-- existan. Esta migración borra las 23 fichas fantasma que esa primera
-- versión alcanzó a crear antes del segundo ajuste. Se verificó que ninguna
-- tiene ventas, fotos, movimientos de stock ni conteos físicos enganchados
-- (se crearon horas antes de este borrado) — el DELETE de `products` arrastra
-- en cascada su publicación en `tiktok_publicaciones` (FK on delete cascade).
--
-- Tras aplicar esto, correr /api/tiktok/sync de nuevo: como estas
-- publicaciones siguen desactivadas en TikTok, el código corregido las va a
-- volver a esconder correctamente (sin crear ficha), sin duplicar inventario.
--
-- Idempotente: si estas filas ya no existen, el DELETE no hace nada.
-- ============================================================================

-- Diagnóstico — revisar antes de borrar.
select id, nombre, variante, sku, stock, activo, tiktok_sku_id, tiktok_product_id, created_at
  from public.products
 where id in (
    '7a4b042c-db58-4acc-8c69-eaf53108c471','7690ec7b-d28a-40de-b98f-75b91d835ba0',
    '5068636b-c9d3-4a84-a4bc-fa5af1cbd126','629a9d53-a9e1-4fbf-825e-d08f332e4a3c',
    '4210b91e-64ae-4f39-871a-6d08025638c3','b0828c19-d5e0-477b-a8e3-a44bfdcd4b4a',
    '2742e27b-df60-464f-80ef-d8711ed0b773','67723056-e987-465c-b631-cb00c6b925fe',
    '8fde73dd-40ff-4f7e-be52-7d1955f24943','37631518-da7c-42bb-8e76-b641338e7982',
    'd7809444-9e20-4aaf-830c-6153a37e5fc6','238cf2ae-9f94-4f11-9277-8f029ceb11dd',
    'dd4c05cc-9ba6-4007-b9a1-3772e715f298','aec48cf0-307e-4994-9a43-71f77e93422e',
    'e0ca9a1a-fe7a-46b6-9370-84eb470da704','470fe550-6d85-4534-bbcc-d4a1ddbf40cf',
    '961eaf1e-50d3-4b0b-936a-a5e8756a8491','a164f273-8606-4a97-8bc9-c6ad4409b65e',
    'b67eed31-3c59-4573-9464-2cc0f1ceccd4','010b2b37-f91b-468a-bc9f-2de2882b5b02',
    '4180d347-91ca-4ea2-99bd-8fbcb877e167','76b309d3-b0e7-41d9-a024-c11053d674c1',
    '2d840583-4593-4310-8ee2-6ed8fff62c53'
 );

-- Borrado — arrastra en cascada la fila correspondiente en tiktok_publicaciones.
delete from public.products
 where id in (
    '7a4b042c-db58-4acc-8c69-eaf53108c471','7690ec7b-d28a-40de-b98f-75b91d835ba0',
    '5068636b-c9d3-4a84-a4bc-fa5af1cbd126','629a9d53-a9e1-4fbf-825e-d08f332e4a3c',
    '4210b91e-64ae-4f39-871a-6d08025638c3','b0828c19-d5e0-477b-a8e3-a44bfdcd4b4a',
    '2742e27b-df60-464f-80ef-d8711ed0b773','67723056-e987-465c-b631-cb00c6b925fe',
    '8fde73dd-40ff-4f7e-be52-7d1955f24943','37631518-da7c-42bb-8e76-b641338e7982',
    'd7809444-9e20-4aaf-830c-6153a37e5fc6','238cf2ae-9f94-4f11-9277-8f029ceb11dd',
    'dd4c05cc-9ba6-4007-b9a1-3772e715f298','aec48cf0-307e-4994-9a43-71f77e93422e',
    'e0ca9a1a-fe7a-46b6-9370-84eb470da704','470fe550-6d85-4534-bbcc-d4a1ddbf40cf',
    '961eaf1e-50d3-4b0b-936a-a5e8756a8491','a164f273-8606-4a97-8bc9-c6ad4409b65e',
    'b67eed31-3c59-4573-9464-2cc0f1ceccd4','010b2b37-f91b-468a-bc9f-2de2882b5b02',
    '4180d347-91ca-4ea2-99bd-8fbcb877e167','76b309d3-b0e7-41d9-a024-c11053d674c1',
    '2d840583-4593-4310-8ee2-6ed8fff62c53'
 );

notify pgrst, 'reload schema';
