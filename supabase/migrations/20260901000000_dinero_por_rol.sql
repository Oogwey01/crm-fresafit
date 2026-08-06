-- ============================================================================
-- 20260901000000_dinero_por_rol.sql
-- ----------------------------------------------------------------------------
-- Quién ve el dinero del negocio.
--
-- Los módulos que PARECEN financieros —Finanzas, Nómina, Reportes, Agencia,
-- Proveedores— ya tenían candado. El dinero se escapaba por las pantallas de
-- operación, que no tenían ninguno: Métricas pintaba las ventas en pesos y el
-- ticket promedio, Canales la comisión de Mercado Libre y lo depositado por
-- TikTok, Inventario el costo por SKU —y con el precio al lado, el margen es
-- una resta— y Clientes lo que gasta cada uno. Todo eso lo veía cualquier
-- miembro del equipo.
--
-- DOS ÁMBITOS, NO TRES:
--
--   ve_egresos()   Lo que sale: gastos, nómina, costo de producto, valor de
--                  inventario. Dirección y administración —quien captura.
--   ve_ingresos()  Lo que entra: ventas, precios, comisiones, gasto por
--                  cliente. Solo dirección.
--
-- El RESULTADO —utilidad, margen, saldo— no es un tercer ámbito: es la resta de
-- los otros dos, así que hace falta ver las dos mitades y sale solo que sea de
-- dirección. Por eso Reportes, que mezcla sueldos con ventas, sube entero.
--
-- Las dos funciones son alias de una línea sobre `es_administrativo()` y
-- `es_admin()`. Existen —en vez de preguntar por el rol a pelo— para que cada
-- consulta se lea por LO QUE PREGUNTA y no por quién lo cumple hoy: el día que
-- administración deje de llevar los gastos, se cambia en un sitio.
--
-- LA EXCEPCIÓN POR CANAL. Cada plataforma tiene su encargado, y para llevarla
-- necesita sus números —cuánto se vendió, qué se llevó de comisión, cuánto
-- depositó— sin ver por eso los del negocio entero. `dinero_permisos_canal` es
-- ese permiso suelto, con la misma forma que `insumo_permisos` de bodega: la
-- FILA es el permiso, sin columna booleana que mantener en dos sitios.
--
-- Lo otorga solo DIRECCIÓN, y esto no es celo: si administración pudiera, se lo
-- daría a sí misma en los tres canales y el cierre de ingresos quedaría en
-- nada. Es el mismo motivo por el que solo dirección cambia los roles del
-- equipo (ver el trigger `proteger_columnas_profiles` de 20250101000002).
--
-- LO QUE ESTA MIGRACIÓN NO PUEDE HACER. La RLS de Postgres filtra FILAS, no
-- columnas, y los GRANT por columna no distinguen a un coordinador de dirección
-- porque para Postgres todos son el mismo rol (`authenticated`); lo que los
-- separa es un claim del JWT, que el sistema de permisos no mira. Así que
-- `sales.monto` y `products.costo` NO se cierran aquí: se dejan de mandar al
-- navegador desde el servidor. Quien quiera cerrarlos de verdad —contra alguien
-- que consulte PostgREST con su propio token— necesita además la migración
-- 20260902000000, que los saca de en medio.
--
-- `sale_orders` sí se cierra entera, y sale gratis: todas sus columnas son
-- dinero, no tiene un solo uso operativo, y los importadores entran con
-- service_role, así que la ingesta ni se entera.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Los dos ámbitos y el permiso por canal
-- ---------------------------------------------------------------------------

create or replace function public.ve_egresos()
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_administrativo();
$$;

create or replace function public.ve_ingresos()
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_admin(auth.uid());
$$;

grant execute on function public.ve_egresos()  to authenticated;
grant execute on function public.ve_ingresos() to authenticated;

create table if not exists public.dinero_permisos_canal (
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  canal        text not null check (canal in ('tienda_nube','mercado_libre','tiktok_shop','punto_fisico','otro')),
  otorgado_por uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (profile_id, canal)
);

grant all on public.dinero_permisos_canal to authenticated, service_role;
alter table public.dinero_permisos_canal enable row level security;

-- Cada quien ve los permisos que tiene (la app los necesita para saber qué
-- pintar) y dirección los ve todos, que es quien los reparte. A diferencia de
-- los de bodega, estos NO son públicos al equipo: la lista de quién ve el
-- dinero es en sí misma información de dirección.
drop policy if exists "dinero canal: ver (propio o direccion)" on public.dinero_permisos_canal;
create policy "dinero canal: ver (propio o direccion)" on public.dinero_permisos_canal
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.ve_ingresos()));

drop policy if exists "dinero canal: gestionar (direccion)" on public.dinero_permisos_canal;
create policy "dinero canal: gestionar (direccion)" on public.dinero_permisos_canal
  for all to authenticated
  using ((select public.ve_ingresos())) with check ((select public.ve_ingresos()));

-- ¿Ve el dinero de ESTE canal? Con `canal_f` nulo —el «Todas las plataformas»
-- de Métricas— la respuesta es que no, salvo que vea los ingresos completos: si
-- el nulo se colara como «todos», el permiso de un solo canal le abriría a su
-- encargado la suma de los demás.
create or replace function public.ve_dinero_canal(canal_f text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.ve_ingresos()
      or (canal_f is not null
          and exists (select 1 from public.dinero_permisos_canal
                       where profile_id = auth.uid() and canal = canal_f));
$$;

grant execute on function public.ve_dinero_canal(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Las órdenes de venta pasan a ser de dirección
-- ---------------------------------------------------------------------------
-- `sale_orders` es la única tabla del CRM en la que TODAS las columnas son
-- dinero: total, subtotal, envío, descuento, impuesto, comisión y costo de
-- envío. No alimenta ninguna pantalla de operación —solo los paneles de canal y
-- las funciones de abajo—, así que cerrarla entera es un cierre de columna de
-- verdad, del que la RLS sí es capaz, y sin coste para nadie.
drop policy if exists "ordenes: ver (interno)" on public.sale_orders;
drop policy if exists "ordenes: ver (ingresos)" on public.sale_orders;
create policy "ordenes: ver (ingresos)" on public.sale_orders
  for select to authenticated using ((select public.ve_ingresos()));

-- ---------------------------------------------------------------------------
-- 3. Métricas: las mismas cifras, sin las de dinero para quien no debe verlas
-- ---------------------------------------------------------------------------
-- Cambia de SECURITY INVOKER a DEFINER, y es a propósito: con `sale_orders`
-- cerrada, una función invoker le devolvería al encargado de TikTok un bruto de
-- cero para su propio canal. Ahora la función lee todo y decide ella qué
-- entrega, que es justo lo que le permite abrirle TikTok a Julio sin abrirle el
-- resto. El `es_interno()` de la primera línea repone el filtro que antes ponía
-- la RLS.
--
-- Sin permiso, los importes salen en NULL —no en cero—: un cero se lee como un
-- dato y `formatearMXN(null)` ya pinta «—». Y para que la pantalla no quede
-- coja, se añade `unidades_por_canal`: las mismas barras, contadas en piezas.
--
-- Los criterios de cálculo NO cambian ni un punto respecto a 20260826000000,
-- incluida la asimetría de los cancelados (las ventas sin estado cuentan, las
-- órdenes sin estado no). Cualquier diferencia que no sean centavos es un error.
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
           s.producto_id, s.descripcion
      from public.sales s
     where s.fecha between desde and hasta
       and (s.estado is null or s.estado <> 'cancelado')
       and (canal_f is null or s.canal = canal_f)
  ),
  ordenes as (
    select o.canal, o.total, o.descuento, o.metodo_pago, o.cupon, o.meses
      from public.sale_orders o
     where o.fecha between desde and hasta
       and o.estado <> 'cancelled'
       and (canal_f is null or o.canal = canal_f)
  ),
  bruto_ordenes as (
    select canal, sum(total) as bruto from ordenes group by canal
  ),
  bruto_renglones as (
    select r.canal, sum(r.monto) as bruto
      from renglones r
     where not (r.origen = 'api'
                and r.canal in (select canal from bruto_ordenes))
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

comment on function public.metricas_resumen(date, date, text) is
  'Resumen de Métricas calculado en la base. Los importes solo viajan si quien pregunta puede verlos (ve_dinero_canal); sin permiso salen en null y se sustituyen por unidades_por_canal.';

grant execute on function public.metricas_resumen(date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Lo que gasta cada cliente
-- ---------------------------------------------------------------------------
-- `compras` y `ultima` son operación —cuántas veces compró y cuándo— y se
-- quedan para todo el equipo. `total` es dinero y solo va para dirección. El
-- `es_interno()` del where repone lo que antes ponía la RLS, con la misma forma
-- que ya usa `unidades_en_camino()` (20260823000000).
create or replace function public.stats_por_cliente()
returns table (
  cliente_id uuid,
  compras    bigint,
  total      numeric,
  ultima     date
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.cliente_id,
    count(*)::bigint as compras,
    case when (select public.ve_ingresos()) then coalesce(sum(s.monto), 0) end as total,
    max(s.fecha)     as ultima
  from public.sales s
  where s.cliente_id is not null
    and (s.estado is null or s.estado <> 'cancelado')
    -- Escalares: se evalúan una vez, no por fila (ver 20260824000000).
    and (select public.es_interno())
  group by s.cliente_id;
$$;

grant execute on function public.stats_por_cliente() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Los dos bloques de dinero de los paneles de canal
-- ---------------------------------------------------------------------------
-- Sustituyen las dos lecturas directas de `sale_orders` que hacían las páginas
-- de Mercado Libre y Tienda Nube. Son las que le abren su plataforma al
-- encargado: el candado de dentro pregunta por ESTE canal, no por los ingresos
-- del negocio, así que Julio ve TikTok y solo TikTok.
--
-- Devuelven NULL —no un error— cuando no hay permiso: los paneles ya saben no
-- pintar el bloque si el dato no viene, y un error ahí tumbaría la pantalla
-- entera por un recuadro.
--
-- `desde` lo calcula quien llama, en TypeScript, porque ahí vive la zona horaria
-- del negocio; `current_date` aquí sería UTC, que en México adelanta el día. Es
-- el mismo criterio de `ventas_reorden(desde)` y `reporte_fresafit(...)`.
--
-- Solo cuentan las órdenes que TRAEN comisión, y esto no es un descuido: las
-- importadas antes de 20260816000000 no la tienen, y mezclarlas hundiría la tasa
-- haciendo creer que el canal cobra menos de lo que cobra. Es el mismo filtro
-- que aplicaba la página.
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
      and o.estado <> 'cancelled'
      and o.comision is not null
      and o.fecha >= desde
  ) end;
$$;

-- Medios de pago y cupones, con el mismo criterio que `resumirPagos`: el
-- denominador son las órdenes que traen medio de pago, porque las que no lo
-- traen no es que se pagaran en efectivo, es que su canal no reporta el dato.
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
       where canal = canal_f and estado <> 'cancelled'
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

grant execute on function public.costos_canal(text, date) to authenticated;
grant execute on function public.pagos_canal(text, date)  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. El reporte de cierre, cerrado a dirección
-- ---------------------------------------------------------------------------
-- Se reescribe entera —y no se envuelve— para que el candado sobreviva a que
-- alguien vuelva a pegar 20260827000000: una envoltura con otro nombre
-- desaparecería en silencio y la función quedaría abierta sin que se note.
--
-- El cuerpo es IDÉNTICO al de 20260827000000. Lo único que cambia son las tres
-- líneas del guardia y el SECURITY DEFINER que este obliga: como el reporte
-- resta egresos de ingresos, verlo es ver las dos mitades, y eso es dirección.
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

comment on function public.reporte_fresafit(date, date, date, date, date) is
  'Reporte de cierre calculado en la base. Solo Dirección: el cierre resta egresos de ingresos, así que verlo es ver las dos mitades.';

grant execute on function public.reporte_fresafit(date, date, date, date, date) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, ANTES de desplegar el código)
-- ----------------------------------------------------------------------------
-- 1) Las cifras de dirección NO se movieron. Con el mismo rango que tenga
--    puesto Métricas, y con la sesión de dirección:
--
--       select jsonb_pretty(public.metricas_resumen('2026-07-01','2026-07-31'));
--
--    `dinero` debe venir en true y kpis.total/ticket con los mismos números que
--    antes. Diferencias de centavos son esperables (Postgres suma numeric con
--    precisión exacta); cualquier otra hay que entenderla antes de seguir.
--
--       select jsonb_pretty(public.reporte_fresafit(
--         '2026-07-01','2026-07-31','2026-06-01','2026-06-30','2026-07-28'));
--
-- 2) Los tres ámbitos contestan lo que deben. Con la sesión de cada quien:
--
--       select public.ve_egresos(), public.ve_ingresos();
--
--    dirección → (t, t) · administración → (t, f) · coordinador y miembro → (f, f)
--
-- 3) El permiso por canal. Dándole TikTok a Julio (ajustar el correo):
--
--       insert into public.dinero_permisos_canal (profile_id, canal, otorgado_por)
--       select p.id, 'tiktok_shop', auth.uid() from public.profiles p
--        join auth.users u on u.id = p.id where u.email = 'juliozea10@gmail.com'
--       on conflict do nothing;
--
--    Y con SU sesión, las tres respuestas que definen el permiso:
--
--       select public.ve_dinero_canal('tiktok_shop');   -- true
--       select public.ve_dinero_canal('mercado_libre'); -- false
--       select public.ve_dinero_canal(null);            -- false  ← la que importa
--
--    La tercera es la que evita que el permiso de un canal acabe enseñando la
--    suma de todos.
--
-- 4) Las órdenes quedaron cerradas. Con sesión de coordinador:
--
--       select count(*) from public.sale_orders;   -- 0
-- ============================================================================
