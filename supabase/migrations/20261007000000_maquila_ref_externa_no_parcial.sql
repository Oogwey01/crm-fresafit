-- ============================================================================
-- 20261007000000_maquila_ref_externa_no_parcial.sql
--   Que la clave idempotente de la maquila sirva para lo único que existe:
--   hacer upsert.
-- ----------------------------------------------------------------------------
-- QUÉ SE ROMPÍA. Cualquier ingesta a `maquila_pedidos` muere con:
--
--     there is no unique or exclusion constraint matching the ON CONFLICT
--     specification
--
-- POR QUÉ. 20260924000000 creó la clave como índice PARCIAL:
--
--     create unique index maquila_ped_ref_externa_uidx
--       on public.maquila_pedidos (canal, referencia_externa)
--       where referencia_externa is not null;          -- ← esto
--
-- Postgres solo infiere el índice de un `on conflict (col, col)` cuando NO es
-- parcial: para uno parcial habría que repetirle el WHERE, y PostgREST no
-- tiene manera de mandarlo. `sales` ya había tropezado con esto y su migración
-- lo dejó escrito (20260714000000, líneas 41-44): «Sin WHERE: PostgREST infiere
-- el índice en upserts (ON CONFLICT) solo si no es parcial». La de maquila
-- copió la intención — su comentario dice «igual que sales_ref_externa_uidx» —
-- pero no la lección.
--
-- POR QUÉ NADIE LO VIO. `maquila_productos` estuvo vacía desde que se escribió
-- el módulo, y aplicarOrdenesMaquila() sale antes de tocar la base cuando no
-- hay fichas (`if (fichas.size === 0) return`). El upsert nunca llegó a
-- ejecutarse. Al sembrar las fichas (20261005000000) el bug quedó al
-- descubierto, y habría tumbado la ingesta EN SILENCIO: la llamada va dentro de
-- un try/catch para que un fallo de maquila no tire la importación de ventas,
-- así que el único rastro habría sido una línea en los logs de Vercel.
--
-- QUITAR EL WHERE ES SEGURO. Los pedidos manuales llevan `referencia_externa`
-- nula, y en un índice único los NULL no chocan entre sí (NULL ≠ NULL, salvo
-- con NULLS NOT DISTINCT, que no se usa aquí). Pueden convivir tantos pedidos
-- manuales como haga falta, exactamente como las ventas manuales en `sales`.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

-- Los dos pasos van en la misma transacción implícita del archivo: entre uno y
-- otro la tabla queda sin su candado de duplicados, y nadie debe poder colarse
-- por ahí.
drop index if exists public.maquila_ped_ref_externa_uidx;

create unique index if not exists maquila_ped_ref_externa_uidx
  on public.maquila_pedidos (canal, referencia_externa);

comment on index public.maquila_ped_ref_externa_uidx is
  'Clave idempotente de la ingesta (webhook + cron + respaldo). SIN WHERE a propósito: PostgREST solo infiere el índice en un upsert si no es parcial. Los NULL de los pedidos manuales no chocan entre sí.';

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
-- 1) El índice ya no es parcial — la columna `indpred` debe salir NULL:
--
--       select indexrelid::regclass as indice, indpred is null as sin_where
--         from pg_index
--        where indexrelid = 'public.maquila_ped_ref_externa_uidx'::regclass;
--
-- 2) Y sigue siendo único sobre las dos columnas:
--
--       select indexdef from pg_indexes
--        where indexname = 'maquila_ped_ref_externa_uidx';
--
-- 3) En la terminal, lo que de verdad importa:
--
--       node --env-file=.env.local scripts/respaldo-maquila.mjs --aplicar \
--         --cerrar-hasta=2026-07-31
-- ============================================================================
