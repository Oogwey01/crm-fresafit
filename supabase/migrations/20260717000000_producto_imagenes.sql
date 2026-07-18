-- ============================================================================
-- Fresafit CRM — Fotos de producto (importadas de Tienda Nube)
-- ----------------------------------------------------------------------------
--   * products.imagen_url: portada de la variante (la imagen propia si la tiene,
--     si no la portada del producto). Es la miniatura que se muestra en la tabla.
--   * products.imagenes: galería completa del producto como array JSON de URLs
--     ordenadas por posición. Se referencia el CDN de Tienda Nube directamente
--     (no se rehospeda en Supabase Storage).
--   Ambas se llenan en la sincronización de catálogo (sincronizarProductosTN);
--   los productos capturados a mano quedan con null / [] y no se ven afectados.
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.products add column if not exists imagen_url text;                        -- portada de la variante
alter table public.products add column if not exists imagenes jsonb not null default '[]'::jsonb;  -- galería (URLs ordenadas)

notify pgrst, 'reload schema';
