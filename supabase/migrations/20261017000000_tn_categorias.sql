-- ============================================================================
-- Categorías de Tienda Nube en el CRM (junta 13/08/2026).
--
-- «Sobre Tienda Nube se decide todo»: las categorías de la tienda (Cinturones,
-- Powerlift, Pro, Liquidación…) ya están bien armadas allá y Armando quiere
-- filtrarlas en el inventario. El CRM las ESPEJEA en solo lectura: las trae la
-- sync (los productos de la API llegan con sus categorías) y aquí no hay UI de
-- edición — si cambian en la tienda, la siguiente sync las refleja.
--
--   * tn_categorias          — el árbol: id de TN, nombre y padre.
--   * product_tn_categorias  — a qué categorías pertenece cada renglón de
--     `products` (cada variante hereda las del producto TN).
--
-- Convive con products.tipo (la clasificación interna de 9 valores): son cosas
-- distintas y ninguna sustituye a la otra.
--
-- RLS: leer todo el equipo interno; escribir nadie por sesión (escribe la sync
-- con service role, que salta RLS). Idempotente.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.tn_categorias (
  id             bigint primary key,          -- el id de la categoría en TN
  nombre         text not null,
  parent_id      bigint,                      -- null = categoría raíz
  actualizado_en timestamptz not null default now()
);

create table if not exists public.product_tn_categorias (
  product_id   uuid not null references public.products(id) on delete cascade,
  categoria_id bigint not null references public.tn_categorias(id) on delete cascade,
  primary key (product_id, categoria_id)
);
create index if not exists ptc_categoria_idx on public.product_tn_categorias(categoria_id);

grant all on
  public.tn_categorias,
  public.product_tn_categorias
  to authenticated, service_role;

alter table public.tn_categorias         enable row level security;
alter table public.product_tn_categorias enable row level security;

-- Solo lectura por sesión: la escritura es de la sync (service role).
drop policy if exists "tn categorias: ver (interno)" on public.tn_categorias;
create policy "tn categorias: ver (interno)" on public.tn_categorias
  for select to authenticated using (public.es_interno());

drop policy if exists "product tn categorias: ver (interno)" on public.product_tn_categorias;
create policy "product tn categorias: ver (interno)" on public.product_tn_categorias
  for select to authenticated using (public.es_interno());

notify pgrst, 'reload schema';
