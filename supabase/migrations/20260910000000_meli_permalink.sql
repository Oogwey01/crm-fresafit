-- ============================================================================
-- products.meli_permalink — la URL pública real de la publicación de ML
-- ----------------------------------------------------------------------------
-- El enlace «Ver en Mercado Libre» se armaba desde el id
-- (articulo.mercadolibre.com.mx/MLM-…), pero ese formato ya no resuelve: ML
-- redirige al listado de la categoría. La API sí entrega el `permalink`
-- exacto en el mismo multiget que ya usa la sync del catálogo, así que se
-- guarda y el CRM enlaza eso. Mientras la sync no haya vuelto a correr, el
-- CRM usa el formato de respaldo MLM-<id>-_JM.
--
-- El grant por columna: `products` tiene SELECT otorgado columna por columna
-- (ver 20260902000000, que esconde `costo` del token del navegador), así que
-- toda columna nueva hay que otorgarla aparte o queda ilegible para el CRM.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta.
-- ============================================================================

alter table public.products add column if not exists meli_permalink text;

grant select (meli_permalink) on public.products to authenticated;

comment on column public.products.meli_permalink is
  'URL pública de la publicación de Mercado Libre (permalink de la API). La refresca la sync del catálogo.';
