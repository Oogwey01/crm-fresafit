-- ============================================================================
-- 20260908000100_conjunto_armados.sql — El libro de lo que se armó en bodega
-- ----------------------------------------------------------------------------
-- Cada renglón es un hecho consumado del piso: «armé 5 conjuntos CMBMS001».
-- Eso descuenta piezas y acredita la ficha del conjunto, y esos movimientos ya
-- quedan en `stock_log`. Entonces, ¿para qué otra tabla?
--
-- Por tres cosas que el ledger no puede dar:
--
--   1. AGRUPAR. En `stock_log` un armado son 3 o 4 renglones sueltos. Aquí es
--      UNO, con su `lote` apuntando a los del ledger para poder ir y volver.
--   2. DESHACER BIEN. `detalle` guarda la foto de lo que se consumió —qué ficha,
--      cuánto, de qué stock a cuál—. Revertir usa ESA foto, no la receta de hoy:
--      entre el armado y el arrepentimiento alguien pudo editar el conjunto, y
--      devolver piezas según la receta nueva descuadraría el inventario.
--   3. LO QUE FALTA SUBIR. El CRM es solo lectura frente a Tienda Nube, Mercado
--      Libre y TikTok (ver lib/inventario/escritura-canales.ts), así que armar
--      sube el stock AQUÍ y allá siguen en cero hasta que alguien lo capture a
--      mano. `subido_en` es esa cuenta pendiente; sin ella el trabajo de bodega
--      se pierde entre el CRM y la tienda.
--
-- No lleva política de insert a propósito: nadie mete un armado que no haya
-- movido stock. La única puerta es `armar_conjunto()`, que es security definer
-- y hace las dos cosas en la misma transacción (ver 20260908000200).
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.conjunto_armados (
  id           uuid primary key default gen_random_uuid(),
  conjunto_id  uuid references public.conjuntos(id) on delete set null,
  -- Copia del SKU: el rastro de un movimiento de stock tiene que sobrevivir a
  -- que alguien borre el conjunto del catálogo. Mismo criterio que en recepción.
  sku_conjunto text not null,
  producto_id  uuid references public.products(id) on delete set null,
  -- 'desarme' es la corrección de un armado, no una operación de piso: siempre
  -- nace apuntando al armado que deshace.
  tipo         text not null check (tipo in ('armado','desarme')),
  cantidad     int  not null check (cantidad > 0),
  -- El mismo uuid que llevan los renglones de `stock_log` de esta operación:
  -- desde el historial de inventario se llega aquí y desde aquí se llega allá.
  lote         uuid not null,
  -- [{producto_id, sku, nombre, cantidad, stock_anterior, stock_nuevo}] — lo que
  -- se consumió, tal como estaba en ese momento. Ver el punto 2 de arriba.
  detalle      jsonb not null default '[]'::jsonb,
  nota         text,
  revierte_a   uuid references public.conjunto_armados(id) on delete set null,
  -- Cuándo se capturó en los canales. NULL = todavía se le debe a la tienda.
  subido_en    timestamptz,
  subido_por   uuid references public.profiles(id) on delete set null,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists conjunto_armados_conjunto_idx
  on public.conjunto_armados(conjunto_id, created_at desc);
create index if not exists conjunto_armados_fecha_idx
  on public.conjunto_armados(created_at desc);
-- Lo pendiente de subir a los canales es lo que más se consulta y es una
-- minoría de la tabla: índice parcial.
create index if not exists conjunto_armados_pendientes_idx
  on public.conjunto_armados(conjunto_id) where subido_en is null;

-- Un armado se deshace UNA vez. Éste es el candado de verdad contra el doble
-- clic en «Deshacer»: la segunda transacción rebota aquí, no en una
-- comprobación que otra sesión pudo adelantar.
create unique index if not exists conjunto_armados_revierte_idx
  on public.conjunto_armados(revierte_a) where revierte_a is not null;

grant all on public.conjunto_armados to authenticated, service_role;
alter table public.conjunto_armados enable row level security;

-- Solo lectura, y solo para el equipo interno: escribir es cosa de las RPC.
-- La llamada de rol va envuelta en (select …) por el InitPlan, ver
-- 20260824000000_rls_initplan.sql.
drop policy if exists "conjunto armados: ver (interno)" on public.conjunto_armados;
create policy "conjunto armados: ver (interno)" on public.conjunto_armados
  for select to authenticated using ((select public.es_interno()));

comment on column public.conjunto_armados.detalle is
  'Foto de las piezas consumidas: [{producto_id, sku, nombre, cantidad, stock_anterior, stock_nuevo}]. Deshacer revierte esto, no la receta actual del conjunto.';
comment on column public.conjunto_armados.lote is
  'Mismo uuid que los renglones de stock_log de esta operación.';
comment on column public.conjunto_armados.subido_en is
  'Cuándo dejó de deberle algo a los canales: o se capturó a mano allá, o se canceló con su desarme antes de subirse. NULL = pendiente (el CRM no escribe stock en Tienda Nube, Mercado Libre ni TikTok).';

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- VERIFICACIÓN
-- ----------------------------------------------------------------------------
-- La tabla nace vacía y con RLS puesta:
--   select relrowsecurity from pg_class where relname = 'conjunto_armados';
--   select count(*) from public.conjunto_armados;
--
-- Una sola política, y de select:
--   select policyname, cmd from pg_policies where tablename = 'conjunto_armados';
