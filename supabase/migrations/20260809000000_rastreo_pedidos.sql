-- ============================================================================
-- 20260809000000_rastreo_pedidos.sql — Enlace de rastreo que da el canal
-- ----------------------------------------------------------------------------
-- El CRM derivaba el enlace de seguimiento a partir del nombre de la paquetería
-- (lib/pedidos/rastreo.ts). Funciona para Estafeta o DHL, pero Tienda Nube manda
-- la URL ya armada en el fulfillment —incluida la de Envío Nube, que agrupa
-- varios transportistas bajo envia.com— y adivinarla desde el nombre no da lo
-- mismo. Guardarla es preferible a inventarla.
--
-- Se añade también al refresco de renglones: como el upsert de `sales` ignora
-- duplicados, sin esto la URL solo llegaría a las ventas insertadas de cero, y
-- los pedidos que ya están esperando a que alguien los empaque —los únicos que
-- de verdad la necesitan— se quedarían sin ella.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.sales
  add column if not exists url_rastreo text;

comment on column public.sales.url_rastreo is
  'Enlace de seguimiento tal como lo entrega el canal. Null = derivarlo de la paquetería.';

-- ----------------------------------------------------------------------------
-- Refresco de renglones ya importados (reemplaza la versión de 20260808).
-- Cambio respecto a la anterior: url_rastreo.
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
