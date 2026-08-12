-- ============================================================================
-- 20261006000100_maquila_tarifas_historicas.sql
--   Las mismas tarifas de Eduardo, vigentes desde antes de que la maquila
--   entrara al CRM.
-- ----------------------------------------------------------------------------
-- QUÉ SE ROMPÍA. `maquila_costos` nació sembrada con `vigente_desde` =
-- 2026-08-01 (20260923000000), el día que se escribió el módulo. Pero Eduardo
-- llevaba produciendo desde abril, y el respaldo del histórico
-- (scripts/respaldo-maquila.mjs) le pregunta a esta tabla cuánto costaba cada
-- pieza EL DÍA DE SU PAGO. Para todo lo anterior a agosto la respuesta era
-- «ninguna tarifa», así que:
--
--   · ningún pedido histórico congelaba costo en `maquila_pedido_costos`, y
--   · ningún corte histórico se podía armar — que es peor de lo que suena:
--     sin un renglón de corte que los reclame, esos 135 pedidos quedan sueltos
--     y el `not exists` de maquila_calcular_corte los deja entrar al PRÓXIMO
--     corte real. A Eduardo se le volvería a cobrar lo de abril a julio.
--
-- QUÉ HACE. Copia las 8 tarifas vigentes hacia atrás, al 2026-04-01 (el mes de
-- la primera venta de maquila registrada). Confirmado con Aarón el 11/08/2026:
-- a Eduardo se le pagaba lo mismo antes de agosto, no hubo aumento.
--
-- NO pisa las del 01/08: `unique (modelo, acabado, vigente_desde)` las deja
-- convivir, y costoVigente() —tanto el de lib/maquila/consultas.ts como su
-- espejo del script— toma siempre la última vigencia anterior o igual a la
-- fecha. Si algún día sube el precio, se agrega una vigencia nueva y estas dos
-- se quedan quietas: es un historial, no una configuración.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

insert into public.maquila_costos (modelo, acabado, costo, vigente_desde)
select c.modelo, c.acabado, c.costo, date '2026-04-01'
  from public.maquila_costos c
 where c.vigente_desde = date '2026-08-01'
on conflict (modelo, acabado, vigente_desde) do nothing;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   -- 16 renglones: los 8 de abril y los 8 de agosto, con el mismo precio.
--   select vigente_desde, modelo, acabado, costo
--     from public.maquila_costos
--    order by vigente_desde, modelo, acabado;
--
--   -- Y lo que importa: que una pieza de mayo ya tenga precio.
--   select costo from public.maquila_costos
--    where modelo = 'powerlift' and acabado = 'bordado_gamuza'
--      and vigente_desde <= date '2026-05-31'
--    order by vigente_desde desc limit 1;        -- 420.00
-- ============================================================================
