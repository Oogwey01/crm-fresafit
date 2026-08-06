-- ============================================================================
-- 20260908000000_conjuntos_ficha.sql — Dónde se acredita un conjunto armado
-- ----------------------------------------------------------------------------
-- Un conjunto (cinturón + muñequeras + straps) se arma en bodega ANTES de
-- venderse y se publica en los canales con SKU propio. O sea que el conjunto
-- tiene DOS caras: la receta —que ya vive en `conjuntos` y
-- `conjunto_componentes`— y la ficha de inventario donde se acumula lo que ya
-- está armado y listo para vender. Esa segunda cara faltaba.
--
-- Se guarda como FK a `products` y NO como una columna `stock` propia: el stock
-- del conjunto es el de su ficha, y punto. Un segundo número se desincronizaría
-- el primer día, porque las sincronizaciones de canal escriben en `products` y
-- no sabrían de esta tabla. Una sola verdad.
--
-- NULL es un estado legítimo y frecuente: los 84 conjuntos que vinieron de la
-- hoja de bodega todavía no existen como SKU vendible. Se quedan en NULL hasta
-- que alguien les cree la ficha y los ligue desde la pantalla; mientras tanto no
-- se pueden armar, y la pantalla lo explica.
--
-- Va solo en su archivo: `add column` con FK toma un candado breve también
-- sobre `products`, y el editor SQL corre todo el buffer en una transacción.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

alter table public.conjuntos
  add column if not exists producto_id uuid references public.products(id) on delete set null;

create index if not exists conjuntos_producto_idx on public.conjuntos(producto_id);

comment on column public.conjuntos.producto_id is
  'Ficha de inventario del conjunto: donde se acredita lo que se arma, y el SKU que se publica en los canales. NULL = el conjunto todavía no existe como producto vendible.';

-- Los que ya casan por SKU quedan atados solos. Hoy no casa ninguno de los 84
-- de la hoja —ninguno tiene ficha—, pero deja resueltos los que se den de alta
-- después y hace que repegar este archivo sea inofensivo.
update public.conjuntos c
   set producto_id = p.id
  from public.products p
 where c.producto_id is null
   and p.sku is not null
   and upper(p.sku) = upper(c.sku);

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- VERIFICACIÓN
-- ----------------------------------------------------------------------------
-- Cuántos conjuntos ya tienen dónde acreditarse. Esperado hoy: 0 de 84.
--   select count(*) filter (where producto_id is not null) as con_ficha,
--          count(*) as total
--     from public.conjuntos;
--
-- La columna quedó con su FK a products:
--   select column_name, is_nullable, data_type
--     from information_schema.columns
--    where table_name = 'conjuntos' and column_name = 'producto_id';
