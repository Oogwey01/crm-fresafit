-- ============================================================================
-- 20261027000100_reparar_producto_id_ventas.sql
--   Devolverle su producto a las ventas que entraron huérfanas, y que no vuelva
--   a pasar.
-- ----------------------------------------------------------------------------
-- EL FALLO (diagnosticado el 24-ago-2026)
--
-- La API de Tienda Nube devuelve `products[].variant_id` con DOS tipos según
-- por dónde se pida la orden:
--
--     GET /orders            (listado, lo usa el CRON)      →  1508700595   número
--     GET /orders/{id}       (detalle, lo usa el WEBHOOK)   → "1508700595"  texto
--
-- El CRM arma sus mapas con las llaves numéricas de la base, así que el texto
-- del webhook no encontraba nada: la venta se guardaba con `producto_id` NULL y
-- el renglón tampoco llegaba al tablero de maquila. Como el cron sí cruzaba, el
-- síntoma parecía intermitente — y era por orden ENTERA, nunca por líneas
-- sueltas, porque cada aviso de webhook trae una sola orden.
--
-- Medido en producción antes de reparar: 227 renglones de Tienda Nube sin
-- producto, de los cuales 210 se recuperan aquí. Los ~17 restantes son de
-- productos que ya no están en el catálogo (líneas descontinuadas y borradas de
-- la tienda) y no tienen a qué ligarse. El dinero nunca estuvo mal —los totales
-- viven en `sale_orders`—, pero todo lo que se agrupa POR PRODUCTO (métricas,
-- inventario, qué se vende más) venía cojo.
--
-- La causa se corrige en el código, en la frontera: `normalizarOrden` en
-- lib/tiendanube/api.ts deja los ids numéricos vengan de donde vengan. Esta
-- migración hace las otras dos partes: reparar lo ya guardado, y dejar el
-- refresco capaz de curarse solo.
--
-- OJO CON EL LINAJE DE ESTA FUNCIÓN. La versión que se recrea abajo parte de la
-- que dejó 20261021000000_envio_subestado.sql, que es la que corre hoy en
-- producción: conserva `envio_subestado` y `envio_logistica` y solo AÑADE
-- `producto_id`. El borrador de esta migración se escribió sobre una copia del
-- repo anterior a esa fecha y, de haberse aplicado tal cual, un
-- `create or replace` habría borrado en silencio el subestado de envío de
-- Mercado Libre. Cualquier cambio futuro a esta RPC tiene que partir de la
-- ÚLTIMA versión, no de la que uno tenga a mano.
--
-- Idempotente: se puede correr dos veces. Se puede pegar tal cual en el SQL
-- Editor.
-- ============================================================================

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Reparar los renglones huérfanos.
-- ---------------------------------------------------------------------------
-- `referencia_externa` es "<order_id>:<variant_id>" en Tienda Nube, así que el
-- producto se recupera del propio renglón sin volver a llamar a la API.
--
-- NO toca el stock: el descuento se hace al INSERTAR la venta
-- (descontar_stock_ventas, en lib/tiendanube/ventas.ts) y aquí solo se rellena
-- una columna de un renglón que ya existía. Las piezas ya salieron de bodega.
--
-- Solo `origen = 'api'` y solo donde está vacío: una asignación hecha a mano
-- desde el CRM nunca se pisa. El regex descarta las referencias que no traen un
-- número en la segunda parte, para que el cast a bigint no reviente.
update public.sales s
   set producto_id = p.id
  from public.products p
 where s.canal = 'tienda_nube'
   and s.origen = 'api'
   and s.producto_id is null
   and split_part(s.referencia_externa, ':', 2) ~ '^[0-9]+$'
   and p.tiendanube_variant_id = split_part(s.referencia_externa, ':', 2)::bigint;

-- ---------------------------------------------------------------------------
-- 2. Que el refresco pueda curar huérfanos futuros.
-- ---------------------------------------------------------------------------
-- El upsert de altas usa `ignoreDuplicates`, así que un renglón mal guardado no
-- se corregía NUNCA por sí solo: esta RPC es el único camino por el que lo ya
-- importado se repara. Le faltaba justo `producto_id`, y por eso los renglones
-- llevaban tres semanas huérfanos mientras las syncs pasaban por encima de
-- ellos todos los días sin arreglarlos.
--
-- `coalesce(s.producto_id, e.producto_id)` es deliberado y va en ese orden:
-- RELLENA lo vacío, jamás pisa lo que ya tiene producto. Sirve además para el
-- caso legítimo de una venta que llega antes de que la sync del catálogo conozca
-- el producto: en cuanto el catálogo lo alcanza, el renglón se liga solo.
create or replace function public.sincronizar_renglones_venta(
  p_canal text,
  p_filas jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with entrada as (
    select
      f->>'referencia_externa'                    as ref,
      (f->>'fecha')::date                         as fecha,
      (f->>'monto')::numeric                      as monto,
      (f->>'cantidad')::int                       as cantidad,
      (f->>'producto_id')::uuid                   as producto_id,
      f->>'estado'                                as estado,
      f->>'paqueteria'                            as paqueteria,
      f->>'num_guia'                              as num_guia,
      f->>'url_rastreo'                           as url_rastreo,
      f->>'url_orden'                             as url_orden,
      f->>'envio_id'                              as envio_id,
      f->>'envio_subestado'                       as envio_subestado,
      f->>'envio_logistica'                       as envio_logistica,
      (f->>'envio_limite_despacho')::timestamptz  as envio_limite_despacho,
      (f->>'envio_despachado_en')::timestamptz    as envio_despachado_en,
      f->'envio_direccion'                        as envio_direccion
    from jsonb_array_elements(p_filas) as f
  ),
  actualizadas as (
    update public.sales s
       set fecha      = e.fecha,
           monto      = e.monto,
           cantidad   = e.cantidad,
           -- Rellena el hueco; nunca pisa el producto ya asignado.
           producto_id = coalesce(s.producto_id, e.producto_id),
           -- El estado solo avanza; ver avanzar_estado_pedido.
           estado     = public.avanzar_estado_pedido(s.estado, e.estado),
           -- La guía puede tardar en aparecer: no borrar la que ya se tenía.
           paqueteria  = coalesce(e.paqueteria, s.paqueteria),
           num_guia    = coalesce(e.num_guia, s.num_guia),
           url_rastreo = coalesce(e.url_rastreo, s.url_rastreo),
           url_orden   = coalesce(e.url_orden, s.url_orden),
           envio_id    = coalesce(e.envio_id, s.envio_id),
           -- El subestado SÍ retrocede si el canal lo dice: describe dónde está
           -- el paquete ahora mismo, no cuánto ha avanzado. `coalesce` solo lo
           -- protege de una respuesta que venga sin el dato.
           envio_subestado = coalesce(e.envio_subestado, s.envio_subestado),
           envio_logistica = coalesce(e.envio_logistica, s.envio_logistica),
           -- Mismo criterio: un envío ya despachado no vuelve a "sin despachar"
           -- porque una respuesta venga incompleta.
           envio_limite_despacho = coalesce(e.envio_limite_despacho, s.envio_limite_despacho),
           envio_despachado_en   = coalesce(e.envio_despachado_en,   s.envio_despachado_en),
           envio_direccion = coalesce(
             nullif(e.envio_direccion, 'null'::jsonb),
             s.envio_direccion
           )
      from entrada e
     where s.canal = p_canal
       and s.origen = 'api'
       and s.referencia_externa = e.ref
       and ( s.fecha       is distinct from e.fecha
          or s.monto       is distinct from e.monto
          or s.cantidad    is distinct from e.cantidad
          or s.producto_id is distinct from coalesce(s.producto_id, e.producto_id)
          or s.estado      is distinct from public.avanzar_estado_pedido(s.estado, e.estado)
          or s.paqueteria  is distinct from coalesce(e.paqueteria, s.paqueteria)
          or s.num_guia    is distinct from coalesce(e.num_guia, s.num_guia)
          or s.url_rastreo is distinct from coalesce(e.url_rastreo, s.url_rastreo)
          or s.url_orden   is distinct from coalesce(e.url_orden, s.url_orden)
          or s.envio_id    is distinct from coalesce(e.envio_id, s.envio_id)
          or s.envio_subestado is distinct from coalesce(e.envio_subestado, s.envio_subestado)
          or s.envio_logistica is distinct from coalesce(e.envio_logistica, s.envio_logistica)
          or s.envio_limite_despacho is distinct from
               coalesce(e.envio_limite_despacho, s.envio_limite_despacho)
          or s.envio_despachado_en is distinct from
               coalesce(e.envio_despachado_en, s.envio_despachado_en)
          or s.envio_direccion is distinct from coalesce(
               nullif(e.envio_direccion, 'null'::jsonb), s.envio_direccion) )
    returning 1
  )
  select count(*) into n from actualizadas;
  return n;
end;
$$;

revoke all on function public.sincronizar_renglones_venta(text, jsonb) from public, anon, authenticated;
grant execute on function public.sincronizar_renglones_venta(text, jsonb) to service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- COMPROBACIÓN (pegar DESPUÉS)
-- ----------------------------------------------------------------------------
--   -- Cuántos renglones de Tienda Nube siguen sin producto, por mes.
--   -- Lo que quede debe ser SOLO de productos que el catálogo no tiene.
--   select date_trunc('month', fecha) as mes, count(*)
--     from public.sales
--    where canal = 'tienda_nube' and producto_id is null and origen = 'api'
--    group by 1 order by 1 desc;
--
--   -- Que la RPC siga sabiendo del subestado de envío (si esto da 0, se perdió
--   -- lo que traía 20261021000000 y hay que revisar).
--   select count(*) from pg_proc
--    where proname = 'sincronizar_renglones_venta'
--      and pg_get_functiondef(oid) like '%envio_subestado%';
-- ============================================================================
