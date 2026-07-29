-- ============================================================================
-- 20260729000000_productos_descontinuado.sql
-- Marca de "descontinuado" para productos: líneas que ya no se reponen (p. ej.
-- las muñequeras OG). Conservan su histórico y su stock, pero quedan fuera de
-- «Qué pedir» y de los avisos de stock, y se ocultan del catálogo vigente.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.products
  add column if not exists descontinuado boolean not null default false;

comment on column public.products.descontinuado is
  'Línea que ya no se repone (p. ej. OG). Fuera de «Qué pedir» y de los avisos de stock; conserva histórico y stock.';

-- Índice parcial: las consultas del catálogo vigente filtran descontinuado=false.
create index if not exists products_vigentes_idx
  on public.products (activo)
  where descontinuado = false;

notify pgrst, 'reload schema';
