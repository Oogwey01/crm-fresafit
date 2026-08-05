-- ============================================================================
-- 20260828000000_bodega_lote.sql — Cerrar una carga en un solo viaje
-- ----------------------------------------------------------------------------
-- «Descontar los checados» es el último paso de una recepción y el que más
-- renglones toca de golpe: una carga de temporada trae doscientos SKUs. Hasta
-- ahora la app los descontaba uno por uno, llamando a descontar_recepcion() por
-- cada renglón. El descuento en sí es instantáneo; lo que se paga es la ida y
-- vuelta a Supabase de cada llamada (~40 ms desde el servidor de Vercel), así
-- que la espera crecía con el tamaño de la carga: casi diez segundos con
-- doscientos renglones, mirando el botón desde el celular en el piso.
--
-- descontar_recepcion_lote() hace ese recorrido del lado de la base: un solo
-- viaje y una sola transacción, o entran todos los renglones o no entra
-- ninguno. La lógica de cada renglón NO se duplica aquí —llama a
-- descontar_recepcion(), que sigue siendo la única que toca products.stock y
-- escribe en stock_log— para que no puedan quedar dos versiones de cómo se suma
-- una recepción y se separen con el tiempo.
--
-- Devuelve cuántos renglones descontó, que es justo lo que la pantalla le dice
-- a quien picó el botón.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create or replace function public.descontar_recepcion_lote(rid uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  fila record;
  n int := 0;
begin
  -- La misma guarda que descontar_recepcion(): la función es security definer,
  -- o sea que corre por encima de la RLS, y sin esto cualquiera con sesión
  -- podría sumarse stock. Se comprueba aquí además de adentro para ni siquiera
  -- empezar a recorrer la carga.
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede mover el inventario.';
  end if;

  -- Solo los CHECADOS: los que siguen en «traer» o «cargado» todavía no se
  -- contaron físicamente y no tienen por qué tocar el stock. Los ya descontados
  -- quedan fuera por partida doble, porque descontar_recepcion() también los
  -- ignora.
  for fila in
    select id
      from public.recepcion_items
     where recepcion_id = rid
       and estado = 'checado'
     order by created_at
  loop
    perform public.descontar_recepcion(fila.id);
    n := n + 1;
  end loop;

  return n;
end;
$$;

grant execute on function public.descontar_recepcion_lote(uuid) to authenticated;

notify pgrst, 'reload schema';
