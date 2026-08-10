-- ============================================================================
-- 20260926000000_estado_pedido.sql — El pedido no retrocede, y las devoluciones
-- dejan de esconderse
-- ----------------------------------------------------------------------------
-- Arregla la raíz de "en Urgentes salen paquetes que ya se enviaron". Eran tres
-- cosas, y dos se resuelven aquí:
--
--   1. `sincronizar_renglones_venta` pisaba el estado con `coalesce(e.estado,
--      s.estado)`: la sync mandaba SIEMPRE. Si alguien corregía a mano un pedido
--      a "entregado" y el canal seguía diciendo "shipped", la siguiente pasada lo
--      devolvía a "enviado" y el pedido volvía a la bandeja. Ahora el estado solo
--      AVANZA (nuevo → preparando → enviado → entregado); `cancelado` y
--      `devuelto` son terminales de excepción y sí se aplican en cualquier
--      momento, porque describen un final, no un avance.
--
--   2. No existía forma de decir "el paquete se regresó". Una devolución se veía
--      igual que un envío en camino: "Enviado" indefinidamente, contado entre los
--      pendientes. Nace el estado `devuelto` y las tres columnas donde el rastreo
--      de la guía deja lo que averiguó.
--
-- Y de paso el reporte cuenta los atrasados con el mismo criterio que la
-- pantalla de Pedidos (solo lo que aún no sale), para que no se contradigan.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

-- ---------------------------------------------------------------- 1. devuelto
-- El CHECK viene de 20260719000000_pedidos.sql. Se recrea con el estado nuevo.
alter table public.sales drop constraint if exists sales_estado_check;
alter table public.sales
  add constraint sales_estado_check
  check (estado in ('nuevo', 'preparando', 'enviado', 'entregado', 'devuelto', 'cancelado'));

-- ------------------------------------------------- 2. lo que dice el rastreo
-- Qué contestó la paquetería la última vez que se le preguntó por la guía. Se
-- guarda aunque no cambie el estado: "Exception: empresa cerrada, sin intento de
-- entrega" es justo lo que hoy obliga a abrir el navegador para enterarse.
alter table public.sales add column if not exists rastreo_estado  text;
alter table public.sales add column if not exists rastreo_detalle text;
alter table public.sales add column if not exists rastreo_en      timestamptz;

comment on column public.sales.rastreo_estado  is
  'Estado que reporta la paqueteria para num_guia (texto del proveedor de rastreo).';
comment on column public.sales.rastreo_detalle is
  'Ultimo evento legible del rastreo ("Entregado", "Exception: empresa cerrada"...).';
comment on column public.sales.rastreo_en      is
  'Cuando se consulto el rastreo por ultima vez.';

-- Los que hay que ir a preguntar: enviados con guía. Es la consulta exacta del
-- cron de rastreo, y sin índice recorre la tabla entera cada mañana.
create index if not exists sales_rastreo_pendiente_idx
  on public.sales (fecha desc)
  where estado = 'enviado' and num_guia is not null;

-- --------------------------------------------- 3. el estado solo hacia adelante
-- Qué tan avanzado está un pedido. -1 = desconocido (nunca gana).
create or replace function public.rango_estado_pedido(e text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case e
           when 'nuevo'      then 0
           when 'preparando' then 1
           when 'enviado'    then 2
           when 'entregado'  then 3
           else -1
         end;
$$;

-- La regla, en un solo lugar: qué estado queda cuando el canal reporta uno.
--
-- `cancelado` y `devuelto` no son escalones del avance sino finales: si llegan,
-- mandan; y si el pedido ya está en uno de ellos, ninguna lectura del canal lo
-- revive (el canal suele seguir diciendo "shipped" de un paquete que se regresó).
create or replace function public.avanzar_estado_pedido(actual text, entrante text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when entrante is null                        then actual
           when entrante in ('cancelado', 'devuelto')   then entrante
           when actual   in ('cancelado', 'devuelto')   then actual
           when actual is null                          then entrante
           when public.rango_estado_pedido(entrante)
                > public.rango_estado_pedido(actual)    then entrante
           else actual
         end;
$$;

-- ------------------------------------ 4. la RPC de refresco, con la regla nueva
-- Idéntica a la de 20260913000000_sales_envio_id.sql salvo en `estado`, que pasa
-- de `coalesce(e.estado, s.estado)` a `avanzar_estado_pedido(...)`.
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
           -- El estado solo avanza; ver avanzar_estado_pedido.
           estado     = public.avanzar_estado_pedido(s.estado, e.estado),
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
          or s.estado      is distinct from public.avanzar_estado_pedido(s.estado, e.estado)
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

-- ------------------------------------- 5. el reporte, con el mismo criterio
-- `reporte_fresafit` cuenta los atrasados como "todo lo que no está entregado ni
-- cancelado y lleva más de tres días", que es justo lo que la pantalla dejó de
-- hacer: metía en la cuenta los pedidos ya despachados. Se parcha sobre la
-- definición viva en vez de repetir aquí las ~500 líneas de la función, que
-- pertenecen a otra migración y divergirían al primer cambio.
do $$
declare
  def   text;
  nuevo text;
  viejo constant text := 'where estado not in (''entregado'',''cancelado'') and fecha < limite_atraso';
  actual constant text := 'where estado in (''nuevo'',''preparando'') and fecha < limite_atraso';
  tocadas integer := 0;
begin
  for def in
    select pg_get_functiondef(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'reporte_fresafit'
  loop
    nuevo := replace(def, viejo, actual);
    if nuevo is distinct from def then
      execute nuevo;
      tocadas := tocadas + 1;
    end if;
  end loop;

  if tocadas = 0 then
    raise notice
      'reporte_fresafit: no se encontro el conteo de atrasados a parchar (ya estaba, o cambio de forma). Revisar a mano.';
  end if;
end $$;

notify pgrst, 'reload schema';
