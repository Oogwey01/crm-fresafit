-- ============================================================================
-- products.tiendanube_permalink — la URL pública del producto en la tienda
-- ----------------------------------------------------------------------------
-- El enlace «Ver en Tienda Nube» solo llevaba al ADMIN (que se arma con el
-- subdominio + id). Para la vista de COMPRADOR hace falta el `canonical_url`
-- que entrega la API (lleva el dominio público real y el slug del producto:
-- https://fresafit.com.mx/productos/…), así que la sync del catálogo lo
-- guarda aquí. null = la sync no ha vuelto a correr desde que existe la
-- columna, y el CRM simplemente no ofrece esa vista todavía.
--
-- El grant por columna: `products` tiene SELECT otorgado columna por columna
-- (ver 20260902000000), así que toda columna nueva hay que otorgarla aparte.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta.
-- ============================================================================

alter table public.products add column if not exists tiendanube_permalink text;

grant select (tiendanube_permalink) on public.products to authenticated;

comment on column public.products.tiendanube_permalink is
  'URL pública del producto en Tienda Nube (canonical_url de la API). La refresca la sync del catálogo.';
