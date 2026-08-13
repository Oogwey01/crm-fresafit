-- ============================================================================
-- 20261013000000_ordenes_retiradas_cuadre.sql
--   Las órdenes canceladas dejan de sumar en Métricas, y el respaldo por
--   renglones pasa a decidirse orden por orden.
-- ----------------------------------------------------------------------------
-- EL DESCUADRE. Métricas cuadraba contra los paneles de los canales al filtrar
-- un día, pero no una semana: en Tienda Nube el CRM daba MÁS que el panel. La
-- causa: cuando una orden se cancela o reembolsa, los importadores retiran sus
-- renglones de `sales`… y `sale_orders` —de donde sale el bruto— no se tocaba
-- jamás. La orden quedaba con su estado original ('open', 'paid') y el filtro
-- `estado <> 'cancelled'` la seguía sumando para siempre. "Ayer" cuadraba
-- porque las cancelaciones tardan días en llegar; una semana las acumula.
-- Verificado en producción: en TODO el histórico de `sale_orders` no existía ni
-- una sola fila con estado 'cancelled'.
--
-- DOS AGRAVANTES del filtro literal `<> 'cancelled'`:
--   · TikTok guarda su status en MAYÚSCULAS ('CANCELLED' ≠ 'cancelled').
--   · El reembolso de Tienda Nube vive en `payment_status`, no en `status`:
--     una orden reembolsada sigue 'open' y ningún filtro por status la ve.
--
-- LO QUE HACE ESTA MIGRACIÓN:
--   1. `orden_viva(estado)` — el corte de órdenes muertas, en UN solo sitio
--      (estaba copiado literal en cuatro funciones), case-insensitive y con el
--      vocabulario completo de los tres canales. La pareja de este predicado es
--      `marcarOrdenesRetiradas` (lib/canales/ventas-cuadre.ts), que es quien
--      escribe esos estados al sincronizar.
--   2. Normaliza a minúsculas los estados ya guardados (los importadores
--      escriben normalizado desde este cambio).
--   3. Redefine `metricas_resumen`, `costos_canal`, `pagos_canal` y
--      `reporte_fresafit` sobre `orden_viva`. Los cuerpos son los de
--      20260901000000 (con sus candados de rol intactos); solo cambian el
--      corte de muertas y el respaldo por renglones.
--   4. El respaldo por renglones deja de ser todo-o-nada por canal: antes, UNA
--      orden del canal en el rango descartaba TODOS sus renglones de API del
--      rango, y los días sin cobertura de `sale_orders` quedaban en cero. Ahora
--      cada renglón se descarta solo si SU orden está archivada (viva o muerta:
--      la muerta lo representa con 0, que además absorbe una cancelación cuyo
--      borrado de renglones hubiera fallado). Ningún peso se cuenta dos veces:
--      cada renglón cuenta por la orden o por sí mismo, nunca por ambos.
--
-- LO QUE NO CAMBIA, a propósito:
--   · La asimetría de 20260826000000: una VENTA sin estado cuenta; una ORDEN
--     sin estado no. `orden_viva(null)` sigue siendo false.
--   · `sales.estado = 'devuelto'` sigue contando como ingreso: un paquete
--     devuelto sin reembolso es dinero cobrado. Los reembolsos reales del canal
--     sí se restan — llegan como orden retirada.
--
-- Idempotente: se puede aplicar las veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

-- ----------------------------------------------------------------------------
-- 1. El corte de órdenes muertas, en un solo sitio
-- ----------------------------------------------------------------------------
-- El vocabulario cubre lo que escriben los importadores desde este cambio
-- ('cancelled', 'refunded', 'voided', 'invalid') más las variantes en español y
-- la grafía con una ele, para que un estado capturado a mano tampoco se escape.
-- `lower(btrim(...))` porque el histórico trae mayúsculas de TikTok y porque el
-- filtro no debe volver a depender de la convención de un canal.
create or replace function public.orden_viva(estado text)
returns boolean
language sql
immutable
as $$
  select estado is not null
     and lower(btrim(estado)) not in
         ('cancelled','canceled','cancelado','cancelada',
          'refunded','reembolsado','voided','anulado','invalid');
$$;

comment on function public.orden_viva(text) is
  'true si la orden sigue contando como ingreso. NULL cuenta como muerta (asimetría documentada en 20260826000000). Escribe estos estados marcarOrdenesRetiradas (lib/canales/ventas-cuadre.ts).';

grant execute on function public.orden_viva(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. El histórico, normalizado una vez
-- ----------------------------------------------------------------------------
-- Los importadores escriben minúsculas desde este cambio; esto empareja lo ya
-- guardado ('COMPLETED', 'IN_TRANSIT'…) para que la tabla no quede mezclada.
update public.sale_orders
   set estado = lower(btrim(estado))
 where estado is not null
   and estado <> lower(btrim(estado));

-- ----------------------------------------------------------------------------
-- 3. metricas_resumen — corte nuevo y respaldo por orden
-- ----------------------------------------------------------------------------
-- Cuerpo de 20260901000000 con tres ediciones: `renglones` carga además la
-- referencia externa, `ordenes` corta con `orden_viva`, y `bruto_renglones`
-- decide por orden (ver cabecera).
create or replace function public.metricas_resumen(
  desde   date,
  hasta   date,
  canal_f text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dinero boolean;
  v_res    jsonb;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede consultar las métricas.'
      using errcode = '42501';
  end if;

  v_dinero := public.ve_dinero_canal(canal_f);

  with
  renglones as (
    select s.id, s.canal, s.fecha, s.monto, s.cantidad, s.origen,
           s.producto_id, s.descripcion, s.referencia_externa
      from public.sales s
     where s.fecha between desde and hasta
       and (s.estado is null or s.estado <> 'cancelado')
       and (canal_f is null or s.canal = canal_f)
  ),
  ordenes as (
    select o.canal, o.total, o.descuento, o.metodo_pago, o.cupon, o.meses
      from public.sale_orders o
     where o.fecha between desde and hasta
       and public.orden_viva(o.estado)
       and (canal_f is null or o.canal = canal_f)
  ),
  bruto_ordenes as (
    select canal, sum(total) as bruto from ordenes group by canal
  ),
  bruto_renglones as (
    -- Respaldo POR ORDEN: el renglón de API se descarta solo si SU orden está
    -- archivada en sale_orders (sin acotar por fecha a propósito: si la orden
    -- quedó con otra fecha, su dinero cuenta en SU rango y el renglón no lo
    -- duplica en este). El probe usa sale_orders_ref_uidx.
    select r.canal, sum(r.monto) as bruto
      from renglones r
     where r.origen <> 'api'
        or not exists (
             select 1 from public.sale_orders o
              where o.canal = r.canal
                and o.referencia_orden =
                    split_part(coalesce(r.referencia_externa, ''), ':', 1))
     group by r.canal
  ),
  bruto_canal as (
    select coalesce(o.canal, r.canal) as canal,
           coalesce(o.bruto, 0) + coalesce(r.bruto, 0) as bruto
      from bruto_ordenes o
      full join bruto_renglones r on r.canal = o.canal
  ),
  -- El reemplazo sin dinero de «Por canal»: mismas barras, en piezas.
  unidades_canal as (
    select r.canal, sum(r.cantidad) as piezas, count(*) as ventas
      from renglones r group by r.canal
  ),
  por_producto as (
    select coalesce(r.producto_id::text, 'libre:' || coalesce(r.descripcion, 'otro')) as clave,
           r.producto_id,
           min(r.descripcion) as descripcion,
           p.nombre,
           p.variante,
           p.tipo,
           sum(r.monto)    as monto,
           sum(r.cantidad) as piezas
      from renglones r
      left join public.products p on p.id = r.producto_id
     group by 1, 2, p.nombre, p.variante, p.tipo
  ),
  por_dia as (
    select r.fecha, sum(r.monto) as total, count(*) as ventas
      from renglones r
     group by r.fecha
  ),
  pagos as (
    select metodo_pago as metodo, count(*) as cantidad, sum(total) as monto
      from ordenes where metodo_pago is not null group by metodo_pago
  ),
  cupones as (
    select cupon as codigo, count(*) as usos, sum(descuento) as descuento
      from ordenes where cupon is not null group by cupon
  )
  select jsonb_build_object(
    'dinero', v_dinero,
    'kpis', (
      select jsonb_build_object(
        'total',  case when v_dinero then coalesce(sum(monto), 0) end,
        'piezas', coalesce(sum(cantidad), 0),
        'ventas', count(*),
        'ticket', case when v_dinero
                       then case when count(*) > 0 then sum(monto) / count(*) else 0 end
                  end
      ) from renglones
    ),
    'bruto_por_canal', case when v_dinero then coalesce((
      select jsonb_agg(jsonb_build_object('canal', canal, 'bruto', bruto) order by bruto desc)
        from bruto_canal
    ), '[]'::jsonb) else '[]'::jsonb end,
    'unidades_por_canal', coalesce((
      select jsonb_agg(jsonb_build_object('canal', canal, 'piezas', piezas, 'ventas', ventas)
                       order by piezas desc)
        from unidades_canal
    ), '[]'::jsonb),
    'por_producto', coalesce((
      select jsonb_agg(jsonb_build_object(
               'clave', clave, 'producto_id', producto_id, 'descripcion', descripcion,
               'nombre', nombre, 'variante', variante, 'tipo', tipo,
               'monto', case when v_dinero then monto end,
               'piezas', piezas
             ) order by case when v_dinero then monto else piezas end desc)
        from por_producto
    ), '[]'::jsonb),
    'por_dia', coalesce((
      select jsonb_agg(jsonb_build_object(
               'fecha', fecha,
               'total', case when v_dinero then total end,
               'ventas', ventas
             ) order by fecha)
        from por_dia
    ), '[]'::jsonb),
    'pagos', jsonb_build_object(
      -- Las formas de pago y los cupones son importes; los CONTEOS de abajo no,
      -- y esos se quedan: dicen cuántas órdenes traen el dato, no cuánto.
      'pagos', case when v_dinero then coalesce((
        select jsonb_agg(jsonb_build_object('metodo', metodo, 'cantidad', cantidad, 'monto', monto)
                         order by cantidad desc) from pagos
      ), '[]'::jsonb) else '[]'::jsonb end,
      'cupones', case when v_dinero then coalesce((
        select jsonb_agg(jsonb_build_object('codigo', codigo, 'usos', usos, 'descuento', descuento)
                         order by usos desc) from cupones
      ), '[]'::jsonb) else '[]'::jsonb end,
      'aMeses',        (select count(*) from ordenes where metodo_pago is not null and coalesce(meses, 1) > 1),
      'conDatoDePago', (select count(*) from ordenes where metodo_pago is not null)
    ),
    'ordenes_periodo', (select count(*) from ordenes)
  ) into v_res;

  return v_res;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Los dos bloques de dinero de los paneles de canal
-- ----------------------------------------------------------------------------
-- Idénticas a 20260901000000; solo cambia el corte de muertas.
create or replace function public.costos_canal(canal_f text, desde date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not (select public.ve_dinero_canal(canal_f)) then null else (
    select jsonb_build_object(
      'ordenes',     count(*),
      'total',       coalesce(sum(o.total), 0),
      'comision',    coalesce(sum(o.comision), 0),
      'costo_envio', coalesce(sum(o.costo_envio), 0)
    )
    from public.sale_orders o
    where o.canal = canal_f
      and public.orden_viva(o.estado)
      and o.comision is not null
      and o.fecha >= desde
  ) end;
$$;

create or replace function public.pagos_canal(canal_f text, desde date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not (select public.ve_dinero_canal(canal_f)) then null else (
    with o as (
      select * from public.sale_orders
       where canal = canal_f and public.orden_viva(estado)
         and fecha >= desde
    )
    select jsonb_build_object(
      'pagos', coalesce((
        select jsonb_agg(jsonb_build_object('metodo', metodo_pago, 'cantidad', n, 'monto', m)
                         order by n desc)
          from (select metodo_pago, count(*) as n, sum(total) as m
                  from o where metodo_pago is not null group by metodo_pago) x
      ), '[]'::jsonb),
      'cupones', coalesce((
        select jsonb_agg(jsonb_build_object('codigo', cupon, 'usos', n, 'descuento', d)
                         order by n desc)
          from (select cupon, count(*) as n, sum(descuento) as d
                  from o where cupon is not null group by cupon) y
      ), '[]'::jsonb),
      'aMeses',        (select count(*) from o where metodo_pago is not null and coalesce(meses, 1) > 1),
      'conDatoDePago', (select count(*) from o where metodo_pago is not null),
      'ordenes',       (select count(*) from o)
    )
  ) end;
$$;

-- ----------------------------------------------------------------------------
-- 5. reporte_fresafit — mismas tres ediciones que metricas_resumen
-- ----------------------------------------------------------------------------
-- Cuerpo de 20260901000000 (candado de dirección intacto); cambian los cortes
-- de `ordenes`/`ordenes_prev` y el respaldo por renglones de los dos bloques.
create or replace function public.reporte_fresafit(
  desde         date,
  hasta         date,
  desde_prev    date,
  hasta_prev    date,
  limite_atraso date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_res jsonb;
begin
  if not public.ve_ingresos() then
    raise exception 'El reporte de cierre es de Dirección.' using errcode = '42501';
  end if;

  with
  renglones as (
    select s.canal, s.monto, s.cantidad, s.origen, s.cliente_id, s.producto_id,
           s.referencia_externa
      from public.sales s
     where s.fecha between desde and hasta
       and (s.estado is null or s.estado <> 'cancelado')
  ),
  renglones_prev as (
    select s.canal, s.monto, s.origen, s.referencia_externa
      from public.sales s
     where s.fecha between desde_prev and hasta_prev
       and (s.estado is null or s.estado <> 'cancelado')
  ),
  ordenes as (
    select o.canal, o.total from public.sale_orders o
     where o.fecha between desde and hasta and public.orden_viva(o.estado)
  ),
  ordenes_prev as (
    select o.canal, o.total from public.sale_orders o
     where o.fecha between desde_prev and hasta_prev and public.orden_viva(o.estado)
  ),
  bruto_canal as (
    select coalesce(o.canal, r.canal) as canal,
           coalesce(o.bruto, 0) + coalesce(r.bruto, 0) as monto
      from (select canal, sum(total) as bruto from ordenes group by canal) o
      full join (
        -- Respaldo POR ORDEN, igual que en metricas_resumen.
        select r2.canal, sum(r2.monto) as bruto from renglones r2
         where r2.origen <> 'api'
            or not exists (
                 select 1 from public.sale_orders so
                  where so.canal = r2.canal
                    and so.referencia_orden =
                        split_part(coalesce(r2.referencia_externa, ''), ':', 1))
         group by r2.canal
      ) r on r.canal = o.canal
  ),
  bruto_canal_prev as (
    select coalesce(o.canal, r.canal) as canal,
           coalesce(o.bruto, 0) + coalesce(r.bruto, 0) as monto
      from (select canal, sum(total) as bruto from ordenes_prev group by canal) o
      full join (
        select r2.canal, sum(r2.monto) as bruto from renglones_prev r2
         where r2.origen <> 'api'
            or not exists (
                 select 1 from public.sale_orders so
                  where so.canal = r2.canal
                    and so.referencia_orden =
                        split_part(coalesce(r2.referencia_externa, ''), ':', 1))
         group by r2.canal
      ) r on r.canal = o.canal
  ),
  cuenta_canal as (
    select canal, count(*) as n from renglones group by canal
  ),
  gastos as (
    select e.categoria, e.monto from public.expenses e
     where e.fecha between desde and hasta
  ),
  gastos_cat as (
    select categoria, sum(monto) as monto, count(*) as cantidad
      from gastos group by categoria
  ),
  agencia as (
    select i.estado,
           greatest(0, coalesce(i.total, 0) - coalesce(i.fondo_delegado, 0)) as honorarios,
           i.pagado_at
      from public.agencia_ingresos i
     where i.estado <> 'cancelado'
  ),
  pedidos as (
    select s.estado, s.fecha from public.sales s
     where s.estado is not null and s.fecha between desde and hasta
  ),
  inv as (
    select p.stock, p.stock_minimo, p.costo from public.products p
     where p.activo and not p.bajo_pedido and not p.descontinuado
  ),
  top_productos as (
    select p.nombre || case when p.variante is not null and p.variante <> ''
                            then ' · ' || p.variante else '' end as nombre,
           sum(r.monto)    as monto,
           sum(r.cantidad) as piezas
      from renglones r
      join public.products p on p.id = r.producto_id
     group by 1
     order by 2 desc
     limit 8
  ),
  tot as (
    select
      round(coalesce((select sum(monto) from bruto_canal), 0), 2)      as ventas,
      round(coalesce((select sum(monto) from bruto_canal_prev), 0), 2) as ventas_prev,
      round(coalesce((select sum(monto) from gastos), 0), 2)           as gastos,
      round(coalesce((select sum(e.monto) from public.expenses e
                       where e.fecha between desde_prev and hasta_prev), 0), 2) as gastos_prev,
      round(coalesce((select sum(n.monto) from public.nomina_pagos n
                       where n.estado = 'pagado'
                         and n.fecha_pago between desde and hasta), 0), 2)      as nomina,
      round(coalesce((select sum(honorarios) from agencia
                       where estado = 'pagado'
                         and pagado_at is not null
                         and pagado_at::date between desde and hasta), 0), 2)   as ag_cobrado,
      round(coalesce((select sum(honorarios) from agencia where estado = 'cobrado'), 0), 2)   as ag_por_cobrar,
      round(coalesce((select sum(honorarios) from agencia where estado = 'calculado'), 0), 2) as ag_sin_facturar,
      (select count(*) from ordenes)   as n_ordenes,
      (select count(*) from renglones) as n_renglones
  )
  select jsonb_build_object(
    'ingresos', jsonb_build_object(
      'ventas',         t.ventas,
      'ventasAnterior', t.ventas_prev,
      'porCanal', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'clave', b.canal,
                 'monto', round(b.monto, 2),
                 'cantidad', coalesce(c.n, 0)
               ) order by b.monto desc)
          from bruto_canal b
          left join cuenta_canal c on c.canal = b.canal
      ), '[]'::jsonb),
      'agencia', t.ag_cobrado,
      'total',   round(t.ventas + t.ag_cobrado, 2)
    ),
    'egresos', jsonb_build_object(
      'gastos',         t.gastos,
      'gastosAnterior', t.gastos_prev,
      'porCategoria', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'clave', categoria, 'monto', round(monto, 2), 'cantidad', cantidad
               ) order by monto desc)
          from gastos_cat
      ), '[]'::jsonb),
      'nomina', t.nomina,
      'total',  round(t.gastos + t.nomina, 2)
    ),
    'resultado', round((t.ventas + t.ag_cobrado) - (t.gastos + t.nomina), 2),
    'margen', case
                when (t.ventas + t.ag_cobrado) > 0
                then round(((t.ventas + t.ag_cobrado) - (t.gastos + t.nomina))
                           / (t.ventas + t.ag_cobrado) * 100, 2)
                else null
              end,
    'ventas', jsonb_build_object(
      'ordenes', case when t.n_ordenes > 0 then t.n_ordenes else t.n_renglones end,
      'piezas',  coalesce((select sum(cantidad) from renglones), 0),
      'ticket',  case
                   when (case when t.n_ordenes > 0 then t.n_ordenes else t.n_renglones end) > 0
                   then round(t.ventas / (case when t.n_ordenes > 0 then t.n_ordenes else t.n_renglones end), 2)
                   else 0
                 end,
      'productos', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'nombre', nombre, 'piezas', piezas, 'monto', round(monto, 2)
               ) order by monto desc)
          from top_productos
      ), '[]'::jsonb)
    ),
    'pedidos', jsonb_build_object(
      'nuevos',     (select count(*) from pedidos where estado = 'nuevo'),
      'preparando', (select count(*) from pedidos where estado = 'preparando'),
      'enviados',   (select count(*) from pedidos where estado = 'enviado'),
      'entregados', (select count(*) from pedidos where estado = 'entregado'),
      'atrasados',  (select count(*) from pedidos
                      where estado not in ('entregado','cancelado') and fecha < limite_atraso)
    ),
    'clientes', jsonb_build_object(
      'nuevos', (select count(*) from public.customers c
                  where c.created_at >= desde::timestamptz
                    and c.created_at < (hasta + 1)::timestamptz),
      'conCompra', (select count(distinct cliente_id) from renglones where cliente_id is not null)
    ),
    'inventario', jsonb_build_object(
      'productos',  (select count(*) from inv),
      'bajoMinimo', (select count(*) from inv where stock <= stock_minimo),
      'sinStock',   (select count(*) from inv where stock <= 0),
      'valorStock', round(coalesce((select sum(stock * coalesce(costo, 0)) from inv), 0), 2)
    ),
    'agencia', jsonb_build_object(
      'cobrado',     t.ag_cobrado,
      'porCobrar',   t.ag_por_cobrar,
      'sinFacturar', t.ag_sin_facturar
    )
  ) into v_res
  from tot t;

  return v_res;
end;
$$;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (SELECTs aparte, no forman parte de la migración)
-- ----------------------------------------------------------------------------
-- 1) El vocabulario quedó normalizado y aparecen las muertas tras el backfill:
--
--      select canal, coalesce(estado,'∅') as estado, count(*), sum(total)
--        from public.sale_orders group by 1,2 order by 1,2;
--
--    Ninguna mayúscula; tras la sync de ventana ancha deben verse 'cancelled'
--    (y 'refunded' en tienda_nube).
--
-- 2) Ya no hay fantasmas — órdenes vivas sin ningún renglón en sales:
--
--      select o.canal, count(*), sum(o.total)
--        from public.sale_orders o
--       where public.orden_viva(o.estado)
--         and not exists (
--           select 1 from public.sales s
--            where s.canal = o.canal and s.origen = 'api'
--              and split_part(s.referencia_externa, ':', 1) = o.referencia_orden)
--       group by 1;
--
--    Fantasma legítimo: solo órdenes anteriores al corte de altas de la primera
--    sync (nunca tuvieron renglones). De la ventana reciente, ~0.
--
-- 3) El cuadre de la semana, con sesión de dirección y contra los paneles:
--
--      select jsonb_pretty(public.metricas_resumen('2026-08-04','2026-08-10'));
--      select jsonb_pretty(public.metricas_resumen('2026-08-04','2026-08-10','tienda_nube'));
--
--    Tienda Nube debe BAJAR (salen canceladas/reembolsadas); un día reciente
--    no debe moverse. `reporte_fresafit` del mismo rango debe dar el mismo
--    ingresos.porCanal.
-- ============================================================================
