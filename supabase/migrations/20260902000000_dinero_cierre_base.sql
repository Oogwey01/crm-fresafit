-- ============================================================================
-- 20260902000000_dinero_cierre_base.sql
-- ----------------------------------------------------------------------------
-- EL CIERRE DE VERDAD. Pegar DESPUÉS de que el código esté desplegado.
--
-- La migración 20260901000000 dejó de mandar los importes al navegador, que
-- resuelve el requisito de pantalla. Lo que NO resuelve es esto: la cookie de
-- sesión de Supabase le es legible al navegador por diseño —`createBrowserClient`
-- la necesita—, así que cualquiera con el CRM abierto puede pegar tres líneas en
-- la consola de DevTools y hacer `GET /rest/v1/sales?select=monto`. No es «hay
-- que saber PostgREST»: es copiar y pegar.
--
-- POR QUÉ NO BASTA LA RLS. La RLS de Postgres filtra FILAS, no columnas: una
-- policy sobre `products` no puede decir «esta persona ve todo menos el costo».
-- Y los GRANT de columna, por sí solos, tampoco distinguen: para Postgres todos
-- los usuarios del CRM son el mismo rol (`authenticated`) y lo que los separa es
-- un claim del JWT, que el sistema de permisos no mira.
--
-- LO QUE SÍ FUNCIONA, y es lo que hace este archivo: quitarle a `authenticated`
-- el permiso de leer ESAS columnas —a todos, dirección incluida— y servirlas por
-- vistas `security definer` que preguntan por el rol. La columna deja de existir
-- para el token del navegador; el importe solo sale por la puerta que valida.
--
--   sales.monto   → vista public.ventas_montos(id, monto)
--   products.costo → vista public.producto_costos(id, costo)
--
-- `products.precio` se queda accesible A PROPÓSITO: es el precio público de la
-- tienda y de las publicaciones de Mercado Libre. Esconderlo en la base sería
-- teatro —se lee entrando a fresafit.com.mx—, así que se sigue omitiendo del
-- payload (que es lo que evita pintarlo) y nada más.
--
-- SOBRE EL GRANT POR COLUMNA. `grant all on <tabla>` otorga SELECT sobre TODAS
-- las columnas, y de ahí no se puede revocar una sola: hay que revocar el SELECT
-- de tabla y volver a otorgarlo columna por columna. Para no dejar una lista
-- escrita a mano que se desactualice al añadir una columna —y que dejaría esa
-- columna ilegible sin que nadie entienda por qué—, el grant se arma leyendo el
-- catálogo. Ojo con esto al crear columnas nuevas en estas dos tablas: hay que
-- volver a pegar este archivo (es idempotente, se puede correr las veces que
-- haga falta).
--
-- LA INGESTA NO SE ENTERA. Los tres importadores y las syncs entran con
-- `service_role` (ver lib/supabase/admin.ts), que es BYPASSRLS y dueño de los
-- objetos: los grants a `authenticated` no le aplican. Comprobado en
-- lib/tiendanube/ventas.ts, lib/mercadolibre/ventas.ts, lib/tiktok/ventas.ts y
-- lib/canales/ventas-cuadre.ts.
--
-- Y LAS ESCRITURAS TAMPOCO. Se revoca SELECT, no UPDATE ni INSERT: registrar una
-- venta con su monto o capturar el costo de un producto sigue funcionando igual.
-- Escribir un número no es verlo.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. sales.monto — fuera del alcance del token del navegador
-- ---------------------------------------------------------------------------
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'sales' and column_name <> 'monto';

  revoke select on public.sales from authenticated;
  execute format('grant select (%s) on public.sales to authenticated', cols);
end $$;

-- El importe de cada venta, para quien pueda verlo. Se consulta aparte y se une
-- por `id` con los renglones: así los `select` de la app conservan sus embeds
-- (`producto:products!producto_id(...)`) y su paginación, que es lo que se
-- habría tenido que rehacer si el listado entero pasara por una función.
--
-- El permiso se decide POR CANAL, no en bloque: el encargado de una plataforma
-- ve los importes de la suya y null en los demás, igual que en Métricas.
--
-- Los permisos se resuelven UNA vez, no por fila. `ve_dinero_canal(s.canal)`
-- habría sido lo natural de leer, pero recibe un dato de la fila, así que
-- Postgres la llamaría una vez por venta —y cada llamada consulta `profiles`—.
-- La lista de canales permitidos se materializa con un `in (select …)`, que se
-- evalúa una sola vez, y `ve_ingresos()` va envuelta en un escalar para que
-- entre como InitPlan. Es el mismo criterio de 20260824000000, donde esa
-- diferencia se midió en 35×.
drop view if exists public.ventas_montos;
create view public.ventas_montos
with (security_invoker = false) as
  select s.id,
         case
           when (select public.ve_ingresos())
             or s.canal in (select canal
                              from public.dinero_permisos_canal
                             where profile_id = (select auth.uid()))
           then s.monto
         end as monto
    from public.sales s
   where (select public.es_interno());

grant select on public.ventas_montos to authenticated;

comment on view public.ventas_montos is
  'El monto de cada venta, enmascarado por ve_dinero_canal(). Es la única vía por la que un token de usuario puede leer sales.monto.';

-- Los ingresos por día del periodo (Finanzas y cualquier suma de entradas). Va
-- como función y no como vista porque quien la usa quiere el agregado, no las
-- 5.000 filas: pedirlas para sumarlas en el navegador era el patrón viejo.
create or replace function public.ingresos_por_dia(desde date)
returns table (fecha date, total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select s.fecha, sum(s.monto) as total
    from public.sales s
   where s.fecha >= desde
     and (s.estado is null or s.estado <> 'cancelado')  -- un cancelado no es ingreso
     and (select public.ve_ingresos())  -- escalar: se evalúa una vez, no por fila
   group by s.fecha;
$$;

grant execute on function public.ingresos_por_dia(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. products.costo — lo mismo, con el ámbito de egresos
-- ---------------------------------------------------------------------------
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'products' and column_name <> 'costo';

  revoke select on public.products from authenticated;
  execute format('grant select (%s) on public.products to authenticated', cols);
end $$;

drop view if exists public.producto_costos;
create view public.producto_costos
with (security_invoker = false) as
  select p.id,
         case when (select public.ve_egresos()) then p.costo end as costo
    from public.products p
   where (select public.es_interno());

grant select on public.producto_costos to authenticated;

comment on view public.producto_costos is
  'El costo de cada ficha, enmascarado por ve_egresos(). Es la única vía por la que un token de usuario puede leer products.costo.';

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, DESPUÉS de este archivo)
-- ----------------------------------------------------------------------------
-- 1) Las columnas quedaron fuera de alcance PARA TODOS, dirección incluida.
--    Con cualquier sesión, las dos deben fallar con «permission denied»:
--
--       select monto from public.sales limit 1;
--       select costo from public.products limit 1;
--
--    Y lo demás debe seguir funcionando:
--
--       select id, fecha, canal from public.sales limit 1;   -- ok
--       select id, nombre, precio from public.products limit 1; -- ok
--
-- 2) Las vistas sí contestan, y según quién pregunte:
--
--       select count(*) filter (where monto is not null) from public.ventas_montos;
--
--    dirección → todas · administración, coordinador y miembro → 0
--    Julio (con TikTok) → solo las de su canal
--
--       select count(*) filter (where costo is not null) from public.producto_costos;
--
--    dirección y administración → todas · el resto → 0
--
-- 3) La ingesta sigue entera. Correr una sync de Tienda Nube desde el CRM y
--    comprobar que el costo se sigue guardando:
--
--       select count(*) from public.products where costo is not null;
--
--    (Se ejecuta con service_role, así que los grants de arriba no le aplican;
--     esto es para verlo, no para dudarlo.)
--
-- 4) La captura sigue funcionando: registrar una venta de prueba desde Métricas
--    con su monto y comprobar que quedó guardado, leyéndolo por la vista.
-- ============================================================================
