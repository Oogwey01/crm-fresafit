-- ============================================================================
-- 20261021000000_envio_subestado.sql — En qué punto del canal está el paquete
-- ----------------------------------------------------------------------------
-- QUÉ FALTABA. El CRM guarda el estado del envío en cuatro escalones (nuevo →
-- preparando → enviado → entregado) y ahí se le acaba el vocabulario. "Preparando"
-- termina significando tres cosas muy distintas:
--
--   · el paquete está sin tocar en la bodega              → hay trabajo
--   · ya está empacado y etiquetado esperando la colecta  → no hay trabajo
--   · está en un centro de Mercado Full, a cientos de km  → nunca hubo trabajo
--
-- Medido el 17/08/2026 sobre los pendientes reales: de 9 pedidos de Mercado
-- Libre en "Preparando", 5 estaban en un centro de Full y 4 esperando la
-- colecta. Ninguno era trabajo de bodega, y los nueve salían en Urgentes.
--
-- Mercado Libre sí lo distingue —`substatus` (ready_for_pickup, in_warehouse,
-- in_packing_list…) y `logistic_type` (fulfillment, cross_docking, drop_off)—,
-- y el CRM tiraba los dos. Aquí se guardan, sin tocar la escala de estados: son
-- el DETALLE de dónde está el paquete, no un escalón nuevo.
--
-- Se guardan crudos, tal como los manda el canal, y la traducción a español vive
-- en el código (lib/canales/despacho.ts). Meter aquí un catálogo de subestados
-- obligaría a una migración cada vez que un canal invente uno.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

alter table public.sales add column if not exists envio_subestado text;
alter table public.sales add column if not exists envio_logistica text;

comment on column public.sales.envio_subestado is
  'Subestado del envio tal como lo manda el canal (ML: ready_for_pickup, in_warehouse, printed...). Detalle de donde esta el paquete, no un estado del CRM.';
comment on column public.sales.envio_logistica is
  'Tipo de logistica del canal (ML: fulfillment = Mercado Full, cross_docking, drop_off, self_service). Dice de quien es el trabajo de despachar.';

-- La regla de 20261004000000: `authenticated` tiene el SELECT de `sales` por
-- COLUMNA, así que una columna nueva nace ilegible para el navegador y la
-- pantalla revienta con "permission denied for table sales" sin decir cuál es.
grant select (envio_subestado) on public.sales to authenticated;
grant select (envio_logistica) on public.sales to authenticated;

-- ------------------------------------- La RPC de refresco, con los dos campos
-- Idéntica a la de 20260926000200_estado_pedido.sql salvo por `envio_subestado`
-- y `envio_logistica`, que siguen el mismo criterio que el resto del envío: una
-- respuesta incompleta del canal NO borra lo que ya se sabía.
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
-- VERIFICACIÓN (pegar aparte, DESPUÉS de este archivo)
-- ----------------------------------------------------------------------------
-- 1) Las columnas existen y `authenticated` las lee:
--
--      select column_name,
--             has_column_privilege('authenticated', 'public.sales', column_name, 'SELECT')
--        from information_schema.columns
--       where table_schema = 'public' and table_name = 'sales'
--         and column_name in ('envio_subestado', 'envio_logistica');
--
--    Esperado: dos filas, las dos en `true`.
--
-- 2) Tras la siguiente sync de Mercado Libre, los pendientes traen el detalle:
--
--      select estado, envio_logistica, envio_subestado, count(*)
--        from public.sales
--       where canal = 'mercado_libre' and estado in ('nuevo','preparando')
--       group by 1, 2, 3 order by 4 desc;
-- ============================================================================
