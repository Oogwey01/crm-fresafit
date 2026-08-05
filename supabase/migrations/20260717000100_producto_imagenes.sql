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
--
-- Renombrado, no reescrito: este archivo era 20260717000000_producto_imagenes.sql
-- y compartía versión con 20260717000000_clientes_correo.sql. El CLI de Supabase
-- usa ese prefijo como clave única en schema_migrations, así que se le movió a
-- ...000100 para deshacer la colisión. El contenido es el mismo y sigue corriendo
-- justo donde corría: después de la otra migración del mismo día.
-- ============================================================================

alter table public.products add column if not exists imagen_url text;                        -- portada de la variante
alter table public.products add column if not exists imagenes jsonb not null default '[]'::jsonb;  -- galería (URLs ordenadas)

notify pgrst, 'reload schema';
