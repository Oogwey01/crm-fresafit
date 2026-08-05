-- ============================================================================
-- 20260827000000_reporte_fresafit.sql
-- ----------------------------------------------------------------------------
-- El reporte de cierre hacía diez lecturas paginadas contra seis tablas —las
-- ventas del periodo y las del anterior, sus órdenes, los gastos de los dos
-- periodos, la nómina, los cobros de la agencia, los pedidos y el catálogo
-- entero— para acabar produciendo unas quince cifras. El catálogo completo, por
-- ejemplo, se bajaba fila por fila nada más que para multiplicar stock por
-- costo y sumarlo.
--
-- Aquí se hacen esas mismas cuentas donde viven los datos. Los criterios NO
-- cambian: son los mismos que aplicaba `lib/reportes/armar.ts`, copiados al pie
-- de la letra para que el reporte de agosto sea comparable con el de julio.
--
-- Un caso que conviene aclarar porque parece un cambio y no lo es: los cobros
-- de la agencia se leían trayendo la tabla ENTERA, sin filtro de fecha, y el
-- filtro se aplicaba después en JavaScript. El resultado era correcto; lo que
-- sobraba era el viaje. Aquí el filtro va dentro de la consulta, así que las
-- cifras son las mismas y lo que cambia es cuánto se mueve para obtenerlas.
-- Los renglones «por cobrar» y «sin facturar» siguen siendo, a propósito, una
-- foto de HOY y no del periodo: son dinero que aún no entra, y lo que interesa
-- de ellos es cuánto hay pendiente ahora mismo.
--
-- Por qué recibe tantas fechas: los rangos y el corte de atraso los calcula
-- quien llama, en TypeScript, porque ahí ya vive la aritmética de calendario
-- del negocio (y su zona horaria). `current_date` aquí sería UTC, que en México
-- adelanta el día. Es el mismo criterio que ya usa `ventas_reorden(desde)`.
--
-- SECURITY INVOKER (el default): corre con los permisos de quien llama, así que
-- la RLS de `expenses`, `nomina_pagos` y `agencia_*` —que son de dirección y
-- administración— sigue mandando igual que antes. Quien no deba ver la nómina
-- no la verá por pedirla a través de esta función.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

create or replace function public.reporte_fresafit(
  desde         date,
  hasta         date,
  desde_prev    date,
  hasta_prev    date,
  limite_atraso date
)
returns jsonb
language sql
stable
as $$
with
-- ---------------------------------------------------------------------------
-- Ventas: renglones y órdenes, del periodo y del anterior.
-- Los criterios de cancelación son asimétricos y así estaban: las VENTAS sin
-- estado cuentan, las ÓRDENES sin estado no. Ver la cabecera de
-- 20260826000000_metricas_resumen.sql, donde se explica por qué.
-- ---------------------------------------------------------------------------
renglones as (
  select s.canal, s.monto, s.cantidad, s.origen, s.cliente_id, s.producto_id
    from public.sales s
   where s.fecha between desde and hasta
     and (s.estado is null or s.estado <> 'cancelado')
),
renglones_prev as (
  select s.canal, s.monto, s.origen
    from public.sales s
   where s.fecha between desde_prev and hasta_prev
     and (s.estado is null or s.estado <> 'cancelado')
),
ordenes as (
  select o.canal, o.total from public.sale_orders o
   where o.fecha between desde and hasta and o.estado <> 'cancelled'
),
ordenes_prev as (
  select o.canal, o.total from public.sale_orders o
   where o.fecha between desde_prev and hasta_prev and o.estado <> 'cancelled'
),
-- Bruto por canal: el total de la orden cuando el canal la reporta, y la suma
-- de renglones cuando no (las ventas capturadas a mano nunca generan orden).
bruto_canal as (
  select coalesce(o.canal, r.canal) as canal,
         coalesce(o.bruto, 0) + coalesce(r.bruto, 0) as monto
    from (select canal, sum(total) as bruto from ordenes group by canal) o
    full join (
      select canal, sum(monto) as bruto from renglones
       where not (origen = 'api' and canal in (select canal from ordenes))
       group by canal
    ) r on r.canal = o.canal
),
bruto_canal_prev as (
  select coalesce(o.canal, r.canal) as canal,
         coalesce(o.bruto, 0) + coalesce(r.bruto, 0) as monto
    from (select canal, sum(total) as bruto from ordenes_prev group by canal) o
    full join (
      select canal, sum(monto) as bruto from renglones_prev
       where not (origen = 'api' and canal in (select canal from ordenes_prev))
       group by canal
    ) r on r.canal = o.canal
),
-- Renglones por canal, para la columna «cantidad» de cada línea.
cuenta_canal as (
  select canal, count(*) as n from renglones group by canal
),
-- ---------------------------------------------------------------------------
-- Gastos y nómina.
-- ---------------------------------------------------------------------------
gastos as (
  select e.categoria, e.monto from public.expenses e
   where e.fecha between desde and hasta
),
gastos_cat as (
  select categoria, sum(monto) as monto, count(*) as cantidad
    from gastos group by categoria
),
-- ---------------------------------------------------------------------------
-- Agencia. Honorarios = lo cobrado menos el fondo que solo se administra (y
-- nunca negativo). «Cobrado» es lo que ENTRÓ dentro del periodo; los otros dos
-- renglones son foto de hoy, a propósito.
-- ---------------------------------------------------------------------------
agencia as (
  select i.estado,
         greatest(0, coalesce(i.total, 0) - coalesce(i.fondo_delegado, 0)) as honorarios,
         i.pagado_at
    from public.agencia_ingresos i
   where i.estado <> 'cancelado'
),
-- ---------------------------------------------------------------------------
-- Pedidos: solo las ventas que llevan estado de envío.
-- ---------------------------------------------------------------------------
pedidos as (
  select s.estado, s.fecha from public.sales s
   where s.estado is not null and s.fecha between desde and hasta
),
-- ---------------------------------------------------------------------------
-- Inventario: foto de HOY, no del periodo (el stock no guarda historia).
-- ---------------------------------------------------------------------------
inv as (
  select p.stock, p.stock_minimo, p.costo from public.products p
   where p.activo and not p.bajo_pedido and not p.descontinuado
),
-- ---------------------------------------------------------------------------
-- Los ocho productos que más dinero dejaron, por nombre · variante.
-- ---------------------------------------------------------------------------
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
-- Totales que se reutilizan abajo.
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
  -- Margen sobre ingresos. Null —y no cero— cuando no hubo ingresos: dividir
  -- entre cero no da «0 %», da que la pregunta no aplica.
  'margen', case
              when (t.ventas + t.ag_cobrado) > 0
              then round(((t.ventas + t.ag_cobrado) - (t.gastos + t.nomina))
                         / (t.ventas + t.ag_cobrado) * 100, 2)
              else null
            end,
  'ventas', jsonb_build_object(
    -- Si el periodo no trajo órdenes importadas, se cuentan los renglones: es
    -- lo único que hay, y dejar el contador en cero daría un ticket infinito.
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
    -- Atrasado = sigue sin entregarse y ya pasaron más de tres días desde la
    -- venta. Mismo criterio que la pantalla de Pedidos.
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
)
from tot t;
$$;

comment on function public.reporte_fresafit(date, date, date, date, date) is
  'Reporte de cierre calculado en la base. Sustituye las diez lecturas paginadas de lib/reportes/armar.ts. Los rangos y el corte de atraso los calcula el caller (zona horaria de México).';

grant execute on function public.reporte_fresafit(date, date, date, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Y de paso, el N+1 de las fichas duplicadas de Mercado Libre.
-- `lib/inventario/duplicados-ml.ts` pedía un `count` de ventas POR CADA ficha
-- repetida, una consulta por ficha. El comentario del código lo daba por bueno
-- («las duplicadas son pocas»), pero es exactamente lo que un `group by`
-- resuelve de una vez, y el día que sean muchas ya no habrá que volver aquí.
-- ---------------------------------------------------------------------------
create or replace function public.conteo_ventas_por_producto(ids uuid[])
returns table (producto_id uuid, ventas bigint)
language sql
stable
as $$
  select s.producto_id, count(*)::bigint
    from public.sales s
   where s.producto_id = any(ids)
   group by s.producto_id;
$$;

grant execute on function public.conteo_ventas_por_producto(uuid[]) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, ANTES de desplegar el código)
-- ----------------------------------------------------------------------------
-- Con el último mes CERRADO, y comparando renglón por renglón contra lo que la
-- pantalla de Reportes muestra hoy para ese mismo mes:
--
--    select jsonb_pretty(public.reporte_fresafit(
--      '2026-07-01', '2026-07-31',   -- periodo
--      '2026-06-01', '2026-06-30',   -- el anterior, del mismo largo
--      current_date - 3              -- corte de pedidos atrasados
--    ));
--
-- Debe coincidir TODO. Si algo baila, hay que entenderlo antes de desplegar el
-- código nuevo; no se despliega para «ver si se arregla».
--
-- Dos salvedades conocidas, las dos a favor de esta versión:
--   · Centavos. Postgres suma `numeric` exacto; JavaScript sumaba en punto
--     flotante y redondeaba al final.
--   · `clientes.nuevos` contaba hasta las 23:59:59 del último día, así que un
--     cliente dado de alta en ese último segundo se perdía. Aquí entra el día
--     completo.
-- ============================================================================
