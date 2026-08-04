-- ============================================================================
-- 20260811000000_url_orden.sql — Enlace a la orden en el panel del canal
-- ----------------------------------------------------------------------------
-- El CRM armaba el enlace a partir del canal y del número de orden. Para Tienda
-- Nube y TikTok basta, pero Mercado Libre NO abre el detalle por número de orden:
-- lo abre por `pack_id` (el identificador del carrito, que agrupa varias órdenes
-- de la misma compra). Al pasarle el número de orden, ML no lo resuelve y manda
-- al listado del día —que es justo lo que se reportó.
--
-- `pack_id` solo lo conoce la API de Mercado Libre, así que el enlace se guarda
-- al importar en vez de deducirlo en pantalla.
--
-- Se añade al refresco de renglones porque el upsert de `sales` ignora
-- duplicados: sin eso, el enlace solo llegaría a las ventas nuevas y las 1 200 ya
-- importadas se quedarían sin él.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.sales
  add column if not exists url_orden text;

comment on column public.sales.url_orden is
  'Enlace al pedido en el panel del canal. Null = derivarlo del canal y la referencia.';

-- ----------------------------------------------------------------------------
-- Refresco de renglones ya importados (reemplaza la versión de 20260809).
-- Cambio respecto a la anterior: url_orden.
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
      f->>'referencia_externa'          as ref,
      (f->>'fecha')::date               as fecha,
      (f->>'monto')::numeric            as monto,
      (f->>'cantidad')::int             as cantidad,
      f->>'estado'                      as estado,
      f->>'paqueteria'                  as paqueteria,
      f->>'num_guia'                    as num_guia,
      f->>'url_rastreo'                 as url_rastreo,
      f->>'url_orden'                   as url_orden,
      f->'envio_direccion'              as envio_direccion
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
