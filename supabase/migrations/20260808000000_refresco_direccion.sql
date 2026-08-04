-- ============================================================================
-- 20260808000000_refresco_direccion.sql — Que la resincronización también
-- rellene la dirección de envío
-- ----------------------------------------------------------------------------
-- `sincronizar_renglones_venta` (migración 20260805) refresca fecha, monto,
-- cantidad, estado y guía de los renglones ya importados, pero NO la dirección.
-- Como el upsert de `sales` ignora los duplicados, eso dejaba la dirección
-- disponible solo para las ventas insertadas de cero: los pedidos que YA estaban
-- en el CRM esperando a que alguien los empaque —los que de verdad la
-- necesitan— se quedaban sin ella para siempre.
--
-- `coalesce` en los dos sentidos: si el canal no manda dirección en esta pasada
-- (Mercado Libre no consulta el envío de las órdenes ya entregadas, por ejemplo)
-- se conserva la que hubiera, en vez de borrarla.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

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
           paqueteria = coalesce(e.paqueteria, s.paqueteria),
           num_guia   = coalesce(e.num_guia, s.num_guia),
           envio_direccion = coalesce(
             nullif(e.envio_direccion, 'null'::jsonb),
             s.envio_direccion
           )
      from entrada e
     where s.canal = p_canal
       and s.origen = 'api'
       and s.referencia_externa = e.ref
       and ( s.fecha      is distinct from e.fecha
          or s.monto      is distinct from e.monto
          or s.cantidad   is distinct from e.cantidad
          or s.estado     is distinct from coalesce(e.estado, s.estado)
          or s.paqueteria is distinct from coalesce(e.paqueteria, s.paqueteria)
          or s.num_guia   is distinct from coalesce(e.num_guia, s.num_guia)
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
