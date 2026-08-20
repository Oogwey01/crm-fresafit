-- ============================================================================
-- 20261025000000_fuera_empaque.sql — Se cae el campo "empaque" del tablero
-- ----------------------------------------------------------------------------
-- 20261024000000 trajo el tablero de la mesa de empaque con tres columnas, una
-- de ellas copiada del rastreador que bodega llevaba fuera del CRM: en qué se
-- empacó (caja, bolsa mediana…), editable en cada tarjeta, con el conteo por
-- tipo arriba del tablero.
--
-- Sobra. El dato se capturaba a mano una vez por paquete y no decidía nada: ni
-- cambia de columna, ni avisa de nada, ni sale en ningún reporte — su único
-- consumidor era el contador de arriba, que responde una pregunta que se puede
-- responder mirando la mesa. Cada campo que se pide llenar sin que mueva una
-- decisión es tiempo de quien empaca, que es justo lo que este tablero venía a
-- ahorrar.
--
-- Se elimina el mismo día que nació y sin un solo renglón capturado (verificado
-- el 19/08/2026: cero ventas con `empaque` distinto de null), así que no hay
-- datos que rescatar. Las otras dos columnas —`etapa_empaque` y
-- `etapa_empaque_en`— se quedan: son el tablero.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

alter table public.sales drop column if exists empaque;

-- Las dos funciones que solo existían para escribir esa columna.
drop function if exists public.guardar_empaque_pedido(uuid, text);
drop function if exists public.empaque_valido(text);

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, DESPUÉS de este archivo)
-- ----------------------------------------------------------------------------
-- 1) La columna ya no está y las otras dos siguen:
--
--      select column_name
--        from information_schema.columns
--       where table_schema = 'public' and table_name = 'sales'
--         and column_name like '%empaque%';
--
--    Esperado: exactamente `etapa_empaque` y `etapa_empaque_en`.
--
-- 2) Las funciones del tablero que SÍ se quedan siguen ahí:
--
--      select proname from pg_proc p
--        join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and proname like '%empaque%';
--
--    Esperado: `etapa_empaque_valida` y `mover_etapa_empaque`, nada más.
-- ============================================================================
