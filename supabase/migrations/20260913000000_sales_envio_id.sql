-- ============================================================================
-- 20260913000000_sales_envio_id.sql — Id del envío de ML para imprimir la guía
-- ----------------------------------------------------------------------------
-- Id del envío (shipment) de Mercado Libre en la venta. Con él el CRM puede
-- pedirle a la API la etiqueta en PDF y abrirla lista para imprimir desde
-- /pedidos, sin ir a buscar la orden al panel de ML. Solo lo llena la sync de
-- Mercado Libre; en los demás canales queda null.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.sales
  add column if not exists envio_id text;

comment on column public.sales.envio_id is
  'Id del shipment en Mercado Libre. Sirve para pedir la etiqueta PDF a la API. Null en los demás canales.';

-- ----------------------------------------------------------------------------
-- Refresco de renglones ya importados (reemplaza la versión de 20260815).
-- Cambio respecto a la anterior: envio_id. Tiene que viajar por el REFRESCO y
-- no solo por el alta: los pedidos pendientes de hoy ya están importados, y son
-- exactamente los que necesitan la etiqueta.
-- ----------------------------------------------------------------------------
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
      f->>'estado'                                as estado,
      f->>'paqueteria'                            as paqueteria,
      f->>'num_guia'                              as num_guia,
      f->>'url_rastreo'                           as url_rastreo,
      f->>'url_orden'                             as url_orden,
      f->>'envio_id'                              as envio_id,
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
           estado     = coalesce(e.estado, s.estado),
           -- La guía puede tardar en aparecer: no borrar la que ya se tenía.
           paqueteria  = coalesce(e.paqueteria, s.paqueteria),
           num_guia    = coalesce(e.num_guia, s.num_guia),
           url_rastreo = coalesce(e.url_rastreo, s.url_rastreo),
           url_orden   = coalesce(e.url_orden, s.url_orden),
           envio_id    = coalesce(e.envio_id, s.envio_id),
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
          or s.estado      is distinct from coalesce(e.estado, s.estado)
          or s.paqueteria  is distinct from coalesce(e.paqueteria, s.paqueteria)
          or s.num_guia    is distinct from coalesce(e.num_guia, s.num_guia)
          or s.url_rastreo is distinct from coalesce(e.url_rastreo, s.url_rastreo)
          or s.url_orden   is distinct from coalesce(e.url_orden, s.url_orden)
          or s.envio_id    is distinct from coalesce(e.envio_id, s.envio_id)
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
