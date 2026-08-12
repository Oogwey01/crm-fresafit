-- ============================================================================
-- 20261004000000_grants_columna_al_dia.sql — Volver a otorgar el SELECT de las
-- columnas nuevas de `sales` y `products`
-- ----------------------------------------------------------------------------
-- QUÉ SE ROMPIÓ. Abrir /pedidos revienta con:
--
--     permission denied for table sales
--
-- ...aunque la RLS y la sesión estén bien. No es RLS: es el GRANT.
--
-- POR QUÉ. 20260902000000_dinero_cierre_base.sql le quitó a `authenticated` el
-- SELECT de TABLA sobre `sales` (para esconder `monto`) y lo devolvió COLUMNA
-- POR COLUMNA, con la lista que había en el catálogo ESE día. Un grant por
-- columna no cubre las columnas que nazcan después: quedan ilegibles para el
-- token del navegador, y Postgres reporta el fallo a nivel de tabla —de ahí que
-- el mensaje no daiga cuál columna es.
--
-- Las tres que faltan son las de 20260926000200_estado_pedido.sql:
-- `rastreo_estado`, `rastreo_detalle` y `rastreo_en`, que entraron a
-- COLUMNAS_PEDIDO (lib/pedidos/consulta.ts) con el rastreo de guías. Por eso la
-- página funcionaba antes del commit del rastreo y dejó de funcionar después:
-- la columna existía sin permiso, pero nadie la pedía.
--
-- QUÉ HACE ESTE ARCHIVO. Recalcula el grant desde el catálogo para las dos
-- tablas del cierre de dinero, igual que 20260902 — así arregla las tres
-- columnas del rastreo y cualquier otra que se haya quedado atrás sin que se
-- note. Lo que sigue fuera de alcance es lo mismo de siempre y a propósito:
-- `sales.monto` y `products.costo`, que solo salen por `ventas_montos` y
-- `producto_costos`.
--
-- LA REGLA, PARA NO REPETIRLO. Al añadir una columna a `sales` o a `products`,
-- la migración que la crea otorga su SELECT en el mismo archivo:
--
--     grant select (columna_nueva) on public.sales to authenticated;
--
-- Es lo que hacen 20260910000000_meli_permalink.sql y
-- 20260911000000_tiendanube_permalink.sql. Si se olvidó, se vuelve a pegar este
-- archivo. Ninguna otra tabla del CRM tiene grants por columna.
--
-- LA INGESTA NO SE ENTERA: las syncs entran con `service_role`, que es dueño de
-- los objetos y no pasa por estos grants.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

do $$
declare
  t record;
  cols text;
begin
  -- (tabla, columna que NO se otorga). El par sale del cierre de dinero:
  -- 20260902000000_dinero_cierre_base.sql.
  for t in
    select * from (values ('sales', 'monto'), ('products', 'costo'))
      as v(tabla, oculta)
  loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into cols
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = t.tabla
       and column_name <> t.oculta;

    -- El revoke y el grant van juntos en este bloque: entre uno y otro la tabla
    -- queda ilegible para `authenticated`, y una transacción sola no deja que
    -- nadie lo vea a medias.
    execute format('revoke select on public.%I from authenticated', t.tabla);
    execute format('grant select (%s) on public.%I to authenticated', cols, t.tabla);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, DESPUÉS de este archivo)
-- ----------------------------------------------------------------------------
-- 1) Las columnas del rastreo ya se leen con una sesión normal del CRM:
--
--       select id, rastreo_estado, rastreo_detalle, rastreo_en
--         from public.sales limit 1;
--
-- 2) Y el dinero sigue fuera de alcance —esto DEBE fallar con «permission
--    denied», con cualquier sesión, dirección incluida:
--
--       select monto from public.sales limit 1;
--       select costo from public.products limit 1;
--
-- 3) Lo que quedó sin otorgar, si alguna vez hay que auditarlo de nuevo:
--
--       select c.column_name
--         from information_schema.columns c
--        where c.table_schema = 'public' and c.table_name = 'sales'
--          and not has_column_privilege('authenticated', 'public.sales',
--                                       c.column_name, 'select');
--
--    Solo debe salir `monto` (y `costo` al correrlo sobre `products`).
--
-- 4) En la app: abrir /pedidos y cambiar el filtro al histórico (usa las mismas
--    COLUMNAS_PEDIDO desde el action).
-- ============================================================================
