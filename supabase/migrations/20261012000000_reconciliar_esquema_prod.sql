-- ============================================================================
-- 20261012000000_reconciliar_esquema_prod.sql
--   Lo que la base de producción tiene y ninguna migración creaba.
-- ----------------------------------------------------------------------------
-- POR QUÉ EXISTE ESTE ARCHIVO. Hasta hoy las migraciones se pegaban a mano en
-- el SQL Editor, y por el mismo camino entraron un par de `alter table` que
-- nunca se escribieron como migración. El síntoma no se ve en producción —ahí
-- las columnas existen— sino en cualquier base levantada DESDE las migraciones:
-- sale sin ellas, y el importador de personalizados truena.
--
-- Se detectó comparando el esquema de las migraciones contra el de producción
-- (`supabase db diff --linked`), el paso previo a sembrar
-- `supabase_migrations.schema_migrations` para poder usar `db push`.
--
-- EN PRODUCCIÓN ESTA MIGRACIÓN NO HACE NADA: todo va con `if not exists` y las
-- tres columnas ya están ahí. Su trabajo es que el repositorio vuelva a ser
-- una descripción fiel de la base.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

-- ----------------------------------------------------------------------------
-- 1. personalizados.clave — la llave de reimportación de la hoja
-- ----------------------------------------------------------------------------
-- La usa scripts/importar-personalizados-xlsx.mjs: cada ficha se marca con
-- `hoja-<nº de renglón>` para que volver a correr la importación actualice el
-- renglón en vez de duplicarlo. El índice es ÚNICO justamente por eso — es lo
-- que convierte la reimportación en un upsert y no en 165 fichas repetidas.
-- Nullable a propósito: los personalizados dados de alta desde el CRM no vienen
-- de ninguna hoja y no tienen renglón que los identifique.

alter table public.personalizados
  add column if not exists clave text;

comment on column public.personalizados.clave is
  'Renglón de origen en la hoja de cálculo (`hoja-<nº>`), llave de idempotencia del importador. Null = ficha creada desde el CRM.';

create unique index if not exists personalizados_clave_idx
  on public.personalizados (clave);

-- ----------------------------------------------------------------------------
-- 2. reportes.datos / reportes.generado_at — las cifras congeladas
-- ----------------------------------------------------------------------------
-- Ambas están vacías en producción (ningún reporte las usa todavía), pero la
-- columna existe y el esquema tiene que decirlo.

alter table public.reportes
  add column if not exists datos       jsonb,
  add column if not exists generado_at timestamptz;

comment on column public.reportes.datos is
  'Cifras del reporte congeladas al generarlo. Null = reporte capturado a mano (los de la Agencia).';

comment on column public.reportes.generado_at is
  'Cuándo se calcularon esas cifras. Null = no lo generó el CRM.';

notify pgrst, 'reload schema';
