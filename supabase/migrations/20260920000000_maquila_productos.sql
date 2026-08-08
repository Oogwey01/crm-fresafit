-- ============================================================================
-- 20260920000000_maquila_productos.sql
--   Qué fichas del catálogo se producen con Eduardo, y cómo.
-- ----------------------------------------------------------------------------
-- La ingesta de Tienda Nube necesita saber, renglón por renglón, si eso que se
-- vendió lo fabrica Eduardo — y con qué modelo (powerlift/hebilla) y acabado
-- (prensado/sublimado/bordado). Nada de eso se puede adivinar del texto de la
-- variante (ahí solo viajan color y talla, ver lib/talla.ts), así que se
-- captura UNA vez por ficha de producto, aquí.
--
-- Es un satélite de `products` y no columnas nuevas en la tabla grande porque
-- la presencia de la fila ES el dato ("este producto va a maquila"): un JOIN
-- vacío = no es de maquila, sin flag que se quede desactualizado. El modelo
-- decide además si lleva palanca (powerlift sí, hebilla no) y el acabado
-- decide la ruta: prensado sale directo (+7 hábiles), el resto va por corte
-- de lunes/jueves (+10 hábiles).
--
-- `combo` es el DEFAULT del producto (qué accesorios acompaña de fábrica);
-- cada pedido puede corregirlo, porque el cliente elige.
--
-- Eduardo NO lee esta tabla: todo lo que necesita viaja en snapshot dentro de
-- `maquila_pedidos`. Por eso la RLS es interna.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.maquila_productos (
  producto_id uuid primary key references public.products(id) on delete cascade,
  modelo      text not null check (modelo in ('powerlift','hebilla')),
  acabado     text not null check (acabado in ('prensado','sublimado','bordado','bordado_gamuza')),
  combo       text not null default 'ninguno'
              check (combo in ('ninguno','munequeras','straps','ambos')),
  -- Apagar sin borrar: la ficha deja de mandarse a maquila pero conserva su
  -- configuración por si vuelve (temporadas, rediseños).
  activo      boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.maquila_productos is
  'Fichas de products que produce Eduardo bajo pedido. La presencia de la fila = "es de maquila"; modelo y acabado deciden palanca, ruta y costo.';

-- `updated_at` al día en cada edición (mismo patrón que bodega_touch, con
-- función propia para que la familia maquila sea autocontenida).
create or replace function public.maquila_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists maquila_productos_touch_trg on public.maquila_productos;
create trigger maquila_productos_touch_trg
  before update on public.maquila_productos
  for each row execute function public.maquila_touch();

-- ---------------------------------------------------------------------------
-- Permisos + RLS: ver es de todo el equipo; marcar/editar fichas es
-- administrativo (decide qué se fabrica y a qué costo se liga).
-- ---------------------------------------------------------------------------
grant all on public.maquila_productos to authenticated, service_role;

alter table public.maquila_productos enable row level security;

drop policy if exists "maquila productos: ver (interno)" on public.maquila_productos;
create policy "maquila productos: ver (interno)" on public.maquila_productos
  for select to authenticated using ((select public.es_interno()));

drop policy if exists "maquila productos: gestionar (admin)" on public.maquila_productos;
create policy "maquila productos: gestionar (admin)" on public.maquila_productos
  for all to authenticated
  using ((select public.es_administrativo()))
  with check ((select public.es_administrativo()));

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select count(*) from public.maquila_productos;   -- 0: se marcan desde /maquila
--   select policyname from pg_policies where tablename = 'maquila_productos';
-- ============================================================================
