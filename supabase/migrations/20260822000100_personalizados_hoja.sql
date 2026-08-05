-- ============================================================================
-- 20260822000100_personalizados_hoja.sql — La hoja «Personalizados FRESA FIT»
-- ----------------------------------------------------------------------------
-- La tabla `personalizados` gana la FECHA LÍMITE (la columna roja de la hoja,
-- que es lo que en realidad se vigila) y sus estados reales: recibido → diseño →
-- Eduardo → producción → listo → enviado. `entregado` se traduce a `enviado`,
-- que es como lo dice la hoja. El modelo suma 'hebilla', el otro tipo de cinto
-- que se personaliza.
--
-- Archivo aparte de insumos y gastos a propósito: el editor SQL corre todo el
-- buffer en una sola transacción, y tocar tres tablas de golpe deadlockeó contra
-- la app en producción. Un archivo = una tabla = candado corto.
--
-- Idempotente: se puede volver a pegar sin romper nada.
-- ============================================================================

set lock_timeout = '10s';

alter table public.personalizados
  add column if not exists fecha_limite date;

-- Los cinturones que se personalizan son Powerlift o de Hebilla; 'sevilla' se
-- deja porque así se pidió en la junta y ya podría estar capturado.
alter table public.personalizados drop constraint if exists personalizados_modelo_check;
alter table public.personalizados add constraint personalizados_modelo_check
  check (modelo in ('sevilla','powerlift','hebilla','otro'));

-- La hoja no tiene 'entregado': tiene 'enviado'. Se traduce ANTES de poner el
-- check nuevo para no dejar filas fuera de la restricción.
alter table public.personalizados drop constraint if exists personalizados_estado_check;
update public.personalizados set estado = 'enviado' where estado = 'entregado';
alter table public.personalizados add constraint personalizados_estado_check
  check (estado in ('recibido','diseno','eduardo','produccion','listo','enviado'));

create index if not exists personalizados_estado_idx on public.personalizados (estado);
create index if not exists personalizados_limite_idx on public.personalizados (fecha_limite);

notify pgrst, 'reload schema';
