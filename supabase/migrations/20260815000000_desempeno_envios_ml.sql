-- ============================================================================
-- 20260815000000_desempeno_envios_ml.sql — Desempeño de envíos de Mercado Libre
-- ----------------------------------------------------------------------------
-- Mercado Libre publica un porcentaje de "demora en el despacho" que decide
-- cuánta exposición nos da y si podemos ofrecer "llega mañana". Ese número es un
-- agregado de 60 días: dice que vamos mal, pero no QUÉ paquete salió tarde ni
-- cuál está por vencerse hoy — que es lo único accionable para logística.
--
-- El dato que falta lo trae cada envío: `shipping_option.estimated_handling_limit`
-- es la hora límite que ML nos pone para entregarle el paquete al transportista,
-- y el historial del envío dice cuándo salió de verdad. Con esos dos se sabe, por
-- pedido, si se cumplió y cuánto falta para el siguiente vencimiento.
--
-- Se guardan en `sales` (no en una tabla aparte) porque son atributos del ENVÍO,
-- igual que la guía y la paquetería, y viven donde ya vive el estado del pedido.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.sales
  add column if not exists envio_limite_despacho timestamptz,
  add column if not exists envio_despachado_en   timestamptz;

comment on column public.sales.envio_limite_despacho is
  'Hora límite que da el canal para entregarle el paquete al transportista. Null = el canal no la reporta.';

comment on column public.sales.envio_despachado_en is
  'Cuándo salió el paquete de verdad. Null = todavía no sale.';

-- Los pendientes por despachar se consultan por límite y estado; sin índice eso
-- es un scan de toda la tabla de ventas cada vez que se abre el tablero.
create index if not exists sales_pendientes_despacho_idx
  on public.sales (envio_limite_despacho)
  where envio_limite_despacho is not null and envio_despachado_en is null;

-- ----------------------------------------------------------------------------
-- Refresco de renglones ya importados (reemplaza la versión de 20260811).
-- Cambio respecto a la anterior: envio_limite_despacho y envio_despachado_en.
--
-- Este paso es el que hace avanzar un pedido ya importado, y es justamente el
-- que importa aquí: el límite de despacho llega con la venta, pero la hora real
-- de salida aparece HORAS DESPUÉS, cuando el paquete ya se recolectó. Sin esto
-- solo se enteraría de la salida el pedido que naciera después del despacho, o
-- sea ninguno.
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
