-- Agregados de ventas calculados en la base, para dejar de bajar miles de
-- renglones de `sales` a Node solo para sumarlos.
--
-- Idempotente: se puede pegar en el SQL Editor las veces que haga falta.
-- SECURITY INVOKER (el default): corren con los permisos del usuario de la
-- sesión, así que la RLS de `sales` aplica igual que en las queries directas
-- que sustituyen.

-- 1) Estadísticas por cliente (módulo Clientes).
--    Sustituye el cálculo en JS que bajaba hasta 10.000 ventas con join de
--    producto: compras, total gastado y última compra por cliente, con el
--    mismo criterio (solo ventas con cliente y no canceladas).
create or replace function public.stats_por_cliente()
returns table (
  cliente_id uuid,
  compras    bigint,
  total      numeric,
  ultima     date
)
language sql
stable
as $$
  select
    s.cliente_id,
    count(*)::bigint            as compras,
    coalesce(sum(s.monto), 0)   as total,
    max(s.fecha)                as ultima
  from public.sales s
  where s.cliente_id is not null
    and (s.estado is null or s.estado <> 'cancelado')
  group by s.cliente_id;
$$;

-- 2) Ventas agrupadas para el cálculo de reabastecimiento (módulo Inventario).
--    Mismas columnas que la query directa que sustituye (fecha, canal,
--    cantidad, producto_id) pero agrupadas por día/canal/producto, que es la
--    granularidad que el panel realmente usa: menos renglones, mismo resultado.
create or replace function public.ventas_reorden(dias int)
returns table (
  fecha       date,
  canal       text,
  cantidad    bigint,
  producto_id uuid
)
language sql
stable
as $$
  select
    s.fecha,
    s.canal,
    sum(s.cantidad)::bigint as cantidad,
    s.producto_id
  from public.sales s
  where s.fecha >= (current_date - make_interval(days => dias))::date
    and (s.estado is null or s.estado <> 'cancelado')
  group by s.fecha, s.canal, s.producto_id;
$$;
