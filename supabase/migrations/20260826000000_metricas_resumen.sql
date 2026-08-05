-- ============================================================================
-- 20260826000000_metricas_resumen.sql
-- ----------------------------------------------------------------------------
-- Métricas bajaba al navegador 5.000 renglones de `sales` y 20.000 órdenes de
-- `sale_orders` —del orden de medio mega— para hacer con ellos, en JavaScript,
-- una decena de sumas. Y como el tope de 5.000 renglones se alcanzaba con un
-- año de historia, la propia pantalla tenía que avisar de que los periodos
-- largos salían cortos: el CRM sabía que estaba dando números incompletos y lo
-- único que podía hacer era advertirlo.
--
-- Esta función hace esas mismas sumas donde están los datos y devuelve el
-- resultado: unos cuantos kilobytes en vez de medio mega, y sin tope, así que
-- el aviso de «faltan las ventas más antiguas» deja de tener razón de ser.
--
-- Es el mismo camino que ya se recorrió con `stats_por_cliente()` y
-- `ventas_reorden()` en `20260804000000_agregados_ventas.sql`; aquí se aplica a
-- la pantalla que más pesaba.
--
-- SECURITY INVOKER (el default, como sus dos hermanas): corre con los permisos
-- de quien la llama, así que la RLS de `sales` y `sale_orders` filtra igual que
-- en las consultas directas que sustituye. No abre ni un dato de más.
--
-- SOBRE REPLICAR EL CÁLCULO AL PIE DE LA LETRA. Los criterios de abajo no son
-- decisiones nuevas: son los que ya aplicaba el panel, copiados tal cual para
-- que las cifras no se muevan. Dos merecen explicación porque parecen erratas y
-- no lo son:
--
--   * Las VENTAS canceladas se excluyen con `estado is null or estado <>
--     'cancelado'`, o sea que las que no tienen estado SÍ cuentan.
--   * Las ÓRDENES canceladas se excluyen con `estado <> 'cancelled'` a secas
--     —sin contemplar el nulo—, así que una orden sin estado NO cuenta. Es
--     asimétrico respecto a lo anterior, pero es exactamente lo que hacía el
--     filtro del panel, y cambiarlo aquí movería los totales.
--
-- La única diferencia esperable frente a lo anterior son centavos: Postgres
-- suma `numeric` con precisión exacta y JavaScript sumaba en punto flotante.
-- Donde haya diferencia, la buena es esta.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

create or replace function public.metricas_resumen(
  desde   date,
  hasta   date,
  canal_f text default null
)
returns jsonb
language sql
stable
as $$
with
-- Renglones de venta del periodo: lo que se vendió en PRODUCTO.
renglones as (
  select s.id, s.canal, s.fecha, s.monto, s.cantidad, s.origen,
         s.producto_id, s.descripcion
    from public.sales s
   where s.fecha between desde and hasta
     and (s.estado is null or s.estado <> 'cancelado')
     and (canal_f is null or s.canal = canal_f)
),
-- Órdenes del periodo: el bruto que reporta el panel de cada plataforma
-- (producto + envío − descuentos).
ordenes as (
  select o.canal, o.total, o.descuento, o.metodo_pago, o.cupon, o.meses
    from public.sale_orders o
   where o.fecha between desde and hasta
     and o.estado <> 'cancelled'
     and (canal_f is null or o.canal = canal_f)
),
-- Bruto por canal según órdenes.
bruto_ordenes as (
  select canal, sum(total) as bruto from ordenes group by canal
),
-- Bruto por canal según renglones, pero SOLO los que no están ya representados
-- por una orden: los capturados a mano (mostrador, CSV) nunca generan orden, y
-- los de un canal que no aportó ninguna orden en el rango entran como respaldo.
-- Ese respaldo no es teórico: `sale_orders` se llena con una migración que se
-- aplica a mano, y sin él el KPI marcaría cero mientras tanto.
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
-- Lo vendido agrupado por ficha. Se devuelven `variante` y `tipo` en crudo
-- porque el desglose por categoría y por talla se sigue haciendo en pantalla:
-- así ese filtro sigue respondiendo al instante, solo que sobre unos cientos de
-- filas ya sumadas en vez de sobre miles de renglones.
por_producto as (
  select coalesce(r.producto_id::text, 'libre:' || coalesce(r.descripcion, 'otro')) as clave,
         r.producto_id,
         -- Agrupado por la CLAVE, nunca por la descripción. Parece un detalle y
         -- no lo es: los tres importadores guardan en `descripcion` el título
         -- que manda cada canal —el de Tienda Nube, el de la publicación de
         -- Mercado Libre, el de TikTok—, así que una misma ficha vendida en dos
         -- sitios llega con dos textos distintos. Si se agrupara también por ahí,
         -- el producto se partiría en varias filas: su monto quedaría repartido,
         -- caería en el ranking de «Productos estrella» y gastaría dos huecos del
         -- top pintando el mismo nombre dos veces. Para las ventas sueltas (sin
         -- ficha) no se pierde nada, porque ahí la descripción ya va dentro de la
         -- clave.
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
-- Medios de pago y cupones, con el mismo criterio que `resumirPagos`: el
-- denominador son las órdenes que TRAEN medio de pago, porque las que no lo
-- traen no es que se pagaran en efectivo, es que su canal no reporta el dato.
pagos as (
  select metodo_pago as metodo, count(*) as cantidad, sum(total) as monto
    from ordenes where metodo_pago is not null group by metodo_pago
),
cupones as (
  select cupon as codigo, count(*) as usos, sum(descuento) as descuento
    from ordenes where cupon is not null group by cupon
)
select jsonb_build_object(
  'kpis', (
    select jsonb_build_object(
      'total',  coalesce(sum(monto), 0),
      'piezas', coalesce(sum(cantidad), 0),
      'ventas', count(*),
      'ticket', case when count(*) > 0 then sum(monto) / count(*) else 0 end
    ) from renglones
  ),
  'bruto_por_canal', coalesce((
    select jsonb_agg(jsonb_build_object('canal', canal, 'bruto', bruto) order by bruto desc)
      from bruto_canal
  ), '[]'::jsonb),
  'por_producto', coalesce((
    select jsonb_agg(jsonb_build_object(
             'clave', clave, 'producto_id', producto_id, 'descripcion', descripcion,
             'nombre', nombre, 'variante', variante, 'tipo', tipo,
             'monto', monto, 'piezas', piezas
           ) order by monto desc)
      from por_producto
  ), '[]'::jsonb),
  'por_dia', coalesce((
    select jsonb_agg(jsonb_build_object('fecha', fecha, 'total', total, 'ventas', ventas)
                     order by fecha)
      from por_dia
  ), '[]'::jsonb),
  'pagos', jsonb_build_object(
    'pagos', coalesce((
      select jsonb_agg(jsonb_build_object('metodo', metodo, 'cantidad', cantidad, 'monto', monto)
                       order by cantidad desc) from pagos
    ), '[]'::jsonb),
    'cupones', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', codigo, 'usos', usos, 'descuento', descuento)
                       order by usos desc) from cupones
    ), '[]'::jsonb),
    'aMeses',        (select count(*) from ordenes where metodo_pago is not null and coalesce(meses, 1) > 1),
    'conDatoDePago', (select count(*) from ordenes where metodo_pago is not null)
  ),
  'ordenes_periodo', (select count(*) from ordenes)
);
$$;

comment on function public.metricas_resumen(date, date, text) is
  'Resumen de Métricas calculado en la base: KPIs, bruto por canal (órdenes con respaldo por renglones), por producto, por día y medios de pago. Sustituye la agregación en JS que bajaba 25.000 filas al navegador.';

grant execute on function public.metricas_resumen(date, date, text) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, ANTES de desplegar el código)
-- ----------------------------------------------------------------------------
-- La prueba que importa es que las cifras coincidan con las que la pantalla
-- muestra HOY. Con el mismo rango que tenga puesto Métricas:
--
--    select jsonb_pretty(public.metricas_resumen('2026-07-01', '2026-07-31'));
--
-- Cotejar contra el panel:
--   kpis.total            → la nota de la tarjeta «Ventas» ("… en producto")
--   kpis.ventas           → tarjeta «Nº de ventas»
--   kpis.piezas           → tarjeta «Piezas vendidas»
--   kpis.ticket           → tarjeta «Ticket promedio»
--   suma de bruto_por_canal → el número grande de la tarjeta «Ventas»
--   bruto_por_canal       → la gráfica «Por canal», barra por barra
--   por_producto (top 5)  → «Productos estrella» sin filtros
--
-- Y filtrando por canal, que debe cuadrar con el selector de plataforma:
--
--    select jsonb_pretty(public.metricas_resumen('2026-07-01','2026-07-31','mercado_libre'));
--
-- Diferencias de centavos son esperables y correctas (ver cabecera). Cualquier
-- diferencia mayor hay que entenderla ANTES de desplegar el código nuevo.
-- ============================================================================
