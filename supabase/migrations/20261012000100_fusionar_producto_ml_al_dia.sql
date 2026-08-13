-- ============================================================================
-- 20261012000100_fusionar_producto_ml_al_dia.sql
--   Producción se quedó con la versión de julio de fusionar_producto_ml.
-- ----------------------------------------------------------------------------
-- QUÉ PASÓ. 20260805000000 reescribió `fusionar_producto_ml` para que delegara
-- en `_fusionar_fichas`, el helper que arrastra TAMBIÉN las fotos, los conteos
-- físicos y las publicaciones de TikTok — cosas posteriores a 20260723000000,
-- que la versión vieja no conocía y por lo tanto dejaba atrás. En la base de
-- producción esa reescritura no quedó: `pg_get_functiondef` devuelve todavía la
-- definición inline de julio (se vio comparando el esquema con `db diff`). El
-- resto de 20260805000000 sí está —`_fusionar_fichas` y
-- `fusionar_producto_tiktok` existen—, así que lo más probable es que después
-- se volviera a pegar 20260723000000 y su `create or replace` la pisara.
--
-- QUÉ SE ROMPÍA MIENTRAS TANTO. Nada ruidoso: fusionar dos fichas de Mercado
-- Libre funcionaba, pero la ficha perdedora se llevaba a la tumba sus fotos,
-- sus conteos físicos y sus publicaciones de TikTok en vez de heredarlas.
--
-- Este archivo es la misma definición de 20260805000000, tal cual. Se separa de
-- 20261012000000 para poder aplicar una sin la otra.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

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

grant execute on function public.fusionar_producto_ml(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
