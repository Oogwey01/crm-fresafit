-- ============================================================================
-- 20261026000000_envio_full_cajas_dimensiones.sql — La columna que el código ya
-- usaba y que ninguna migración creaba
-- ----------------------------------------------------------------------------
-- QUÉ ESTÁ MAL. `envio_full_cajas.dimensiones` existe en producción y el CRM
-- cuenta con ella —la declara lib/types.ts y aparece en los tipos generados—,
-- pero no hay una sola migración que la cree: se añadió a mano desde el panel de
-- Supabase. Mientras producción sea la única base del mundo, nadie lo nota.
--
-- CUÁNDO DUELE. Al levantar cualquier otro entorno desde este repo —el de
-- diseño, uno de pruebas, el día que haya que restaurar de cero— la tabla nace
-- sin la columna y la primera consulta que la nombre revienta. Se descubrió
-- exactamente así, clonando los datos a un entorno nuevo: 938 columnas en
-- producción contra 937 reconstruidas por las migraciones.
--
-- POR QUÉ `IF NOT EXISTS`. En producción la columna ya está, así que aplicar
-- esto allá no cambia absolutamente nada. Lo único que hace es poner por escrito
-- algo que hasta hoy solo sabía la base.
-- ============================================================================

alter table public.envio_full_cajas
  add column if not exists dimensiones text;
