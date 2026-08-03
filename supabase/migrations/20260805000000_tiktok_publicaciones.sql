-- ============================================================================
-- Fresafit CRM — Publicaciones de TikTok Shop por producto (+ limpieza)
-- ----------------------------------------------------------------------------
-- El mismo artículo puede tener VARIAS publicaciones en TikTok Shop: una que se
-- borró y se volvió a subir, un borrador, una versión con otro título. Todas
-- llevan el mismo `seller_sku` y mueven el mismo inventario físico.
--
-- El CRM las trataba como productos distintos: la sync solo podía vincular una
-- publicación por ficha (`products.tiktok_sku_id` es una sola columna), así que
-- la segunda publicación con el mismo SKU CREABA UNA FICHA NUEVA. Resultado el
-- 02/08/2026: 32 renglones fantasma con 328 unidades que no existen y 26 ventas
-- colgadas de fichas duplicadas — entre ellos el "Cinturón de Powerlift Gamuza
-- Lavanda" (SBD043), que quedó con 20/20/10/10 de una publicación borrada en
-- mayo, además de sus 6/10/3/3 reales.
--
-- Mismo remedio que Mercado Libre (ver 20260723000000_meli_publicaciones.sql):
--
--   * `products` guarda la publicación PRINCIPAL (tiktok_product_id/sku_id).
--   * `tiktok_publicaciones` guarda TODAS las publicaciones que apuntan a esa
--     ficha. Es el mapa que usa la importación de ventas para saber a qué
--     producto pertenece una orden, venga por la publicación que venga.
--
-- Incluye la fusión de las fichas fantasma que YA están en la base. Se fusiona
-- solo cuando no hay ambigüedad: una ficha solo-TikTok cuyo SKU tiene EXACTA-
-- MENTE UNA ficha del catálogo real (Tienda Nube / Mercado Libre). Los SKUs
-- repetidos entre publicaciones de TikTok que no existen en el catálogo —hoy
-- MQR017P, dos muñequeras distintas publicadas con el mismo SKU— NO se tocan:
-- ahí el error está en TikTok y hay que corregirlo allá.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- tiktok_publicaciones: 1 producto → N publicaciones de TikTok Shop
-- ----------------------------------------------------------------------------
create table if not exists public.tiktok_publicaciones (
  id                bigint generated always as identity primary key,
  tiktok_sku_id     text not null,   -- unidad vendible (lo que trae la orden)
  tiktok_product_id text not null,   -- ficha de TikTok que la contiene
  producto_id       uuid not null references public.products(id) on delete cascade,
  principal         boolean not null default false,
  creado_en         timestamptz not null default now()
);

-- Un sku de TikTok pertenece a UN solo producto del CRM.
create unique index if not exists tiktok_publicaciones_sku_uidx
  on public.tiktok_publicaciones (tiktok_sku_id);
create index if not exists tiktok_publicaciones_producto_idx
  on public.tiktok_publicaciones (producto_id);
create index if not exists tiktok_publicaciones_product_idx
  on public.tiktok_publicaciones (tiktok_product_id);

grant all on public.tiktok_publicaciones to authenticated, service_role;
alter table public.tiktok_publicaciones enable row level security;

-- Solo lectura para el equipo interno: quien escribe es la sync (service_role)
-- o el RPC de fusión (security definer).
drop policy if exists "tiktok publicaciones: ver (interno)" on public.tiktok_publicaciones;
create policy "tiktok publicaciones: ver (interno)" on public.tiktok_publicaciones
  for select to authenticated using (public.es_interno());

-- Backfill: lo que hoy vive en products es la publicación principal de cada ficha.
insert into public.tiktok_publicaciones (tiktok_sku_id, tiktok_product_id, producto_id, principal)
  select tiktok_sku_id, tiktok_product_id, id, true
    from public.products
   where tiktok_sku_id is not null and tiktok_product_id is not null
on conflict (tiktok_sku_id) do nothing;

-- ----------------------------------------------------------------------------
-- _fusionar_fichas(ganador, perdedor) — el trabajo sucio, sin control de acceso
-- ----------------------------------------------------------------------------
-- Mueve TODO lo que cuelga del perdedor al ganador y borra el perdedor. No
-- comprueba permisos: es interna (los wrappers de abajo son los que se exponen)
-- y también la usa la limpieza de esta misma migración, que corre sin sesión.
--
-- El stock NO se suma: las dos fichas venían reflejando el MISMO inventario
-- físico, así que sumarlas duplicaría el conteo. Se conserva el del ganador.
create or replace function public._fusionar_fichas(p_ganador uuid, p_perdedor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_perdedor    uuid;
  v_tt_product  text;
  v_tt_sku      text;
begin
  if p_ganador = p_perdedor then
    raise exception 'No se puede fusionar una ficha consigo misma.';
  end if;

  select id, tiktok_product_id, tiktok_sku_id
    into v_perdedor, v_tt_product, v_tt_sku
    from public.products where id = p_perdedor for update;
  if v_perdedor is null then
    raise exception 'La ficha a fusionar ya no existe.';
  end if;
  if not exists (select 1 from public.products where id = p_ganador) then
    raise exception 'La ficha que debía quedarse ya no existe.';
  end if;

  -- Historial: se repunta al ganador para no perder ventas ni movimientos.
  update public.sales                set producto_id = p_ganador where producto_id = p_perdedor;
  update public.stock_log            set producto_id = p_ganador where producto_id = p_perdedor;
  update public.supplier_order_items set producto_id = p_ganador where producto_id = p_perdedor;
  update public.stock_canal_log      set producto_id = p_ganador where producto_id = p_perdedor;
  update public.conteos_fisicos      set producto_id = p_ganador where producto_id = p_perdedor;

  -- Fotos: pasan al ganador salvo que ya tenga ese mismo archivo.
  delete from public.product_photos hijo
   where hijo.producto_id = p_perdedor
     and exists (select 1 from public.product_photos g
                  where g.producto_id = p_ganador and g.storage_path = hijo.storage_path);
  update public.product_photos set producto_id = p_ganador where producto_id = p_perdedor;

  -- Última foto de stock por canal (una fila por producto): solo si el ganador
  -- no tiene la suya; si la tiene, la del perdedor se va con él.
  update public.stock_canal set producto_id = p_ganador
   where producto_id = p_perdedor
     and not exists (select 1 from public.stock_canal where producto_id = p_ganador);

  -- Publicaciones de los canales: las del perdedor quedan como secundarias del
  -- ganador (la principal del ganador no se toca).
  update public.meli_publicaciones
     set producto_id = p_ganador, principal = false
   where producto_id = p_perdedor;
  update public.tiktok_publicaciones
     set producto_id = p_ganador, principal = false
   where producto_id = p_perdedor;

  delete from public.products where id = p_perdedor;

  /* Vínculo con TikTok: si el ganador no tenía publicación propia, se queda con
     la del perdedor (solo se puede después del delete: products.tiktok_sku_id
     es único). Esa publicación pasa a ser la principal de la ficha. */
  if v_tt_sku is not null then
    update public.products
       set tiktok_product_id = coalesce(tiktok_product_id, v_tt_product),
           tiktok_sku_id     = coalesce(tiktok_sku_id, v_tt_sku)
     where id = p_ganador;

    update public.tiktok_publicaciones
       set principal = true
     where producto_id = p_ganador
       and tiktok_sku_id = v_tt_sku
       and exists (select 1 from public.products
                    where id = p_ganador and tiktok_sku_id = v_tt_sku);
  end if;
end;
$$;

revoke all on function public._fusionar_fichas(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- fusionar_producto_tiktok(ganador, perdedor) — para el equipo interno
-- ----------------------------------------------------------------------------
create or replace function public.fusionar_producto_tiktok(p_ganador uuid, p_perdedor uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede fusionar productos.';
  end if;
  perform public._fusionar_fichas(p_ganador, p_perdedor);
end;
$$;

grant execute on function public.fusionar_producto_tiktok(uuid, uuid) to authenticated, service_role;

-- La fusión de Mercado Libre pasa por el mismo helper: así también arrastra las
-- fotos, los conteos físicos y las publicaciones de TikTok, que son posteriores
-- a aquella migración y se quedaban atrás.
create or replace function public.fusionar_producto_ml(p_ganador uuid, p_perdedor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user_product text;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede fusionar productos.';
  end if;

  select meli_user_product_id into v_user_product
    from public.products where id = p_perdedor;

  perform public._fusionar_fichas(p_ganador, p_perdedor);

  -- Si el ganador aún no tenía registrada la unidad de inventario, la hereda.
  update public.products
     set meli_user_product_id = coalesce(meli_user_product_id, v_user_product)
   where id = p_ganador;
end;
$$;

-- ----------------------------------------------------------------------------
-- Limpieza: fusionar las fichas fantasma que dejó la sync
-- ----------------------------------------------------------------------------
-- Perdedora  = ficha que SOLO existe en TikTok (sin Tienda Nube ni Mercado
--              Libre) y cuyo SKU ya tiene ficha en el catálogo real.
-- Ganadora   = esa ficha del catálogo, y solo si es única para ese SKU.
-- Sin ganadora única no se toca nada: dos publicaciones de TikTok que comparten
-- SKU pueden ser productos distintos con el SKU mal puesto.
do $$
declare
  par record;
  n int := 0;
begin
  for par in
    select p.id as perdedor, g.id as ganador, p.sku
      from public.products p
      join public.products g
        on upper(btrim(g.sku)) = upper(btrim(p.sku))
       and g.id <> p.id
       and (g.tiendanube_variant_id is not null or g.meli_item_id is not null)
     where p.tiktok_sku_id is not null
       and p.tiendanube_variant_id is null
       and p.meli_item_id is null
       and coalesce(btrim(p.sku), '') <> ''
       and (select count(*) from public.products g2
             where upper(btrim(g2.sku)) = upper(btrim(p.sku))
               and (g2.tiendanube_variant_id is not null or g2.meli_item_id is not null)) = 1
  loop
    perform public._fusionar_fichas(par.ganador, par.perdedor);
    n := n + 1;
  end loop;
  raise notice 'Fichas fantasma de TikTok fusionadas: %', n;
end $$;

notify pgrst, 'reload schema';
