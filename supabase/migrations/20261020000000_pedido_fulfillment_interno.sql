-- ============================================================================
-- 20261020000000_pedido_fulfillment_interno.sql — Bodega vuelve a poder mover
-- el pedido (y solo el pedido)
-- ----------------------------------------------------------------------------
-- QUÉ SE ROMPIÓ. En /pedidos, quien no es dirección cambia el estado en el
-- selector, ve el toast verde "… → Enviado." y el pedido NO se mueve. Al
-- recargar sigue en "Preparando", y en el filtro de Urgentes sigue rojo.
--
-- POR QUÉ. 20260805000100_ventas_cuadre.sql cerró la edición de las ventas
-- traídas por API:
--
--     using (es_interno() and (origen <> 'api' or es_admin(auth.uid())))
--
-- Esa regla es correcta y se queda: nació porque cualquier interno podía
-- cambiar monto y cantidad de una venta de Mercado Libre desde Métricas y el
-- CRM dejaba de cuadrar con el canal para siempre. Lo que no se vio es que
-- HOY TODOS los pedidos pendientes son `origen = 'api'` —Tienda Nube, Mercado
-- Libre y TikTok entran solos—, así que la misma llave dejó fuera al equipo que
-- empaca. Un UPDATE que la RLS descarta no es un error: PostgREST responde 204
-- con cero filas tocadas, y el server action lo leía como éxito. De ahí el
-- toast que miente.
--
-- LA DISTINCIÓN QUE FALTABA. Editar una venta (monto, cantidad, producto) toca
-- el DINERO y sigue siendo de dirección. Mover el pedido (estado del envío,
-- paquetería, guía) es el trabajo diario de bodega y no toca ni un peso. RLS no
-- distingue columnas, así que la separación se hace donde sí se puede: dos
-- funciones `security definer` que escriben EXACTAMENTE esas columnas y nada
-- más. El resto de la tabla sigue bajo la llave de dirección.
--
-- `cancelado` no entra: cancelar una venta la saca de Métricas y del stock, que
-- es justo el lado del dinero. Se queda para dirección, por el camino normal.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

-- ------------------------------------------------- 1. estados que puede poner
-- El CHECK de la tabla (20260926000200) admite seis; bodega maneja los cinco
-- del ciclo del envío. Se declara aparte para que la lista viva en un solo
-- lugar y las dos funciones la compartan.
create or replace function public.estado_pedido_operativo(e text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select e in ('nuevo', 'preparando', 'enviado', 'entregado', 'devuelto');
$$;

comment on function public.estado_pedido_operativo(text) is
  'Estados del ciclo de envio que el equipo interno puede poner a mano (cancelado NO: mueve dinero y stock).';

-- ---------------------------------------------------- 2. mover el pedido
-- Devuelve cuántas filas se movieron: 0 significa "ese pedido ya no existe" y
-- el action lo dice en voz alta, en vez de fingir que guardó.
create or replace function public.mover_estado_pedido(p_id uuid, p_estado text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede mover pedidos.'
      using errcode = 'check_violation';
  end if;
  if not public.estado_pedido_operativo(p_estado) then
    raise exception 'Ese estado no se pone a mano desde Pedidos (%).', p_estado
      using errcode = 'check_violation';
  end if;

  update public.sales
     set estado = p_estado
   where id = p_id
     -- Una venta ya cancelada no revive por aquí: el retiro movió stock y
     -- Métricas, y deshacerlo es una decisión de dirección, no un clic.
     and estado is distinct from 'cancelado';
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.mover_estado_pedido(uuid, text) is
  'Cambia SOLO sales.estado (ciclo del envio) para cualquier interno, incluidas las ventas origen=api. Devuelve filas tocadas.';

-- ------------------------------------------------ 3. paqueteria y guia
-- Mismo criterio: el dato con el que bodega trabaja, escrito por la puerta
-- estrecha. `url_rastreo` se borra a propósito —apuntaba a la guía anterior— y
-- el CRM la deriva de la paquetería (lib/pedidos/rastreo.ts).
create or replace function public.guardar_envio_pedido(
  p_id         uuid,
  p_paqueteria text,
  p_num_guia   text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede editar envios.'
      using errcode = 'check_violation';
  end if;

  update public.sales
     set paqueteria  = nullif(btrim(coalesce(p_paqueteria, '')), ''),
         num_guia    = nullif(btrim(coalesce(p_num_guia, '')), ''),
         url_rastreo = null
   where id = p_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.guardar_envio_pedido(uuid, text, text) is
  'Escribe SOLO paqueteria/num_guia (y limpia url_rastreo) para cualquier interno. Devuelve filas tocadas.';

-- --------------------------------------------------------------- 4. permisos
-- `security definer` se salta la RLS, así que el EXECUTE es la única puerta:
-- se cierra para todos y se abre solo al token del navegador ya autenticado
-- (la guarda de rol vive dentro de cada función).
revoke all on function public.estado_pedido_operativo(text)          from public, anon;
revoke all on function public.mover_estado_pedido(uuid, text)        from public, anon;
revoke all on function public.guardar_envio_pedido(uuid, text, text) from public, anon;

grant execute on function public.estado_pedido_operativo(text)          to authenticated, service_role;
grant execute on function public.mover_estado_pedido(uuid, text)        to authenticated, service_role;
grant execute on function public.guardar_envio_pedido(uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, DESPUÉS de este archivo)
-- ----------------------------------------------------------------------------
-- 1) Las tres funciones existen y solo las llama quien debe:
--
--      select p.proname, p.prosecdef, array_agg(a.rolname order by a.rolname)
--        from pg_proc p
--        join pg_namespace n on n.oid = p.pronamespace
--        left join aclexplode(p.proacl) x on x.privilege_type = 'EXECUTE'
--        left join pg_roles a on a.oid = x.grantee
--       where n.nspname = 'public'
--         and p.proname in ('mover_estado_pedido','guardar_envio_pedido')
--       group by 1, 2;
--
--    Esperado: prosecdef = true y, en la lista de roles, `authenticated` y
--    `service_role` — nunca `anon` ni `public`.
--
-- 2) Con una sesión de bodega (rol `miembro`), desde /pedidos: cambiar el
--    estado de un pedido de Mercado Libre y RECARGAR. Antes volvía al estado
--    viejo; ahora se queda. Si el pedido ya no existe, el toast lo dice.
--
-- 3) La llave del dinero sigue puesta: con esa misma sesión, un UPDATE directo
--    de `monto` sobre una venta `origen = 'api'` debe seguir tocando 0 filas.
-- ============================================================================
