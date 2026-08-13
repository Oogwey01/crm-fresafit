-- ============================================================================
-- 20261010000000_maquila_arte_historico.sql
--   Dar por entregado el arte de lo que ya se venía produciendo.
-- ----------------------------------------------------------------------------
-- QUÉ RESUELVE. A partir de ahora el tablero de Eduardo solo enseña lo que ya
-- se puede producir: un personalizado aparece cuando diseño lo suelta (la ficha
-- pasa a «En producción» o le suben el arte), y lo de catálogo —los cinturones
-- de gamuza PRO— entra derecho al venderse. El corte lo hace `esperaArte`
-- (lib/maquila/reglas.ts): tiene personalizado o diseño ligado y `diseno_listo_en`
-- vacío.
--
-- El problema es el arranque: `diseno_listo_en` NUNCA se había marcado —la
-- columna nació en 20261002000000 y solo la escribe el arte subido—, así que
-- los pedidos vivos, que son todos personalizados, quedarían fuera de golpe y
-- Eduardo amanecería con el tablero en blanco. Esto los da por diseñados para
-- que el filtro solo aplique a lo que entre de aquí en adelante.
--
-- POR QUÉ `coalesce(pagado_en, created_at)` Y NO `now()`. Hasta hoy el sistema
-- se comportaba como si el arte estuviera listo desde el pago: el pedido caía
-- en el tablero y el plazo corría desde ahí. Estampar `now()` inventaría que el
-- arte de un pedido de junio se entregó en agosto, y la primera medición de
-- «cuánto tarda diseño» saldría con meses de demora que nunca existieron.
--
-- LO QUE **NO** HACE: recalcular la promesa. `recalcularArranqueMaquila` corre
-- cuando el arte se entrega de verdad, y aplicarlo aquí mandaría las promesas
-- vencidas de junio y julio a +10 días hábiles desde hoy — justo los pedidos
-- que urgen desaparecerían de «Hoy» y de «Atrasados».
--
-- Alcanza a TODOS los pedidos con ficha ligada, no solo a los vivos, para que
-- el historial no pinte ⏳ «falta el arte» sobre cinturones ya entregados.
--
-- Sin columnas nuevas: no hay que regenerar tipos.
--
-- Idempotente (`diseno_listo_en is null`): se puede volver a correr, y no pisa
-- el arte que alguien haya marcado a mano.
-- APLICADA en prod el 12/08/2026 con `supabase db push`: 73 pedidos estampados,
-- 0 vivos sin arte, y «Hoy» siguió enseñando los mismos 27 de siempre.
-- ============================================================================

set lock_timeout = '10s';

update public.maquila_pedidos
   set diseno_listo_en = coalesce(pagado_en, created_at)
 where personalizado_id is not null
   and diseno_listo_en is null
   and estado <> 'esperando_pago';

-- `diseno_listo_por` se queda en NULL a propósito: nadie entregó este arte hoy.
-- Es la misma convención que usa maquila_eventos para lo que hace el sistema.

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   -- Debe dar 0: ningún personalizado vivo sin arte marcado.
--   select count(*) from public.maquila_pedidos
--    where personalizado_id is not null and diseno_listo_en is null
--      and estado <> 'esperando_pago';
--
--   -- Lo que Eduardo verá en «Hoy» (debe seguir siendo lo mismo que antes):
--   select count(*) from public.maquila_pedidos
--    where estado in ('recibido','pendiente_produccion','en_produccion','terminado')
--      and fecha_prometida <= (now() at time zone 'America/Mexico_City')::date
--      and (personalizado_id is null and diseno_id is null or diseno_listo_en is not null);
--
--   -- Y lo que queda en «Esperando diseño» (0 el primer día, luego lo nuevo):
--   select count(*) from public.maquila_pedidos
--    where estado in ('recibido','pendiente_produccion','en_produccion','terminado')
--      and (personalizado_id is not null or diseno_id is not null)
--      and diseno_listo_en is null;
-- ============================================================================
