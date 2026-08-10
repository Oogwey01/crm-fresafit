-- ============================================================================
-- 20260927000000_maquila_insumos.sql
--   Lo que Fresa Fit le manda a Eduardo y él guarda: consignación.
-- ----------------------------------------------------------------------------
-- Un PowerLift Pro lleva palanca, y la palanca la ponemos nosotros: se le
-- mandan 30 y él las va gastando conforme salen los pedidos. Con los combos
-- pasa igual (muñequeras y straps). Eso es mercancía nuestra en su bodega —
-- consignación—, y hasta hoy el CRM no lo sabía: `requiere_palanca` y `combo`
-- eran etiquetas de armado que no descontaban nada.
--
-- Por qué tabla propia y no una columna `stock_maquila` en products, que es
-- como están Mercado Full y TikTok:
--
--   * hace falta la BITÁCORA, no solo el saldo. La pregunta real es «cuándo le
--     mandé las últimas y cuántas se han ido desde entonces», y una columna no
--     la contesta;
--   * las palancas hoy NO tienen ficha en el catálogo (no se venden sueltas),
--     así que no habría fila donde poner la columna. Por eso `producto_id` es
--     nullable: con ficha, mandarle piezas baja bodega; sin ficha, solo lleva
--     el saldo hasta que alguien la dé de alta.
--
-- El saldo vive en su propia tabla y NO tiene policy de escritura: se toca
-- solo por las RPC de 20260927000100 (mismo criterio que insumo_movimientos).
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.maquila_insumos (
  id          uuid primary key default gen_random_uuid(),
  -- La clave con la que el trigger de consumo lo encuentra. Es contrato con
  -- lib/maquila/consignacion.ts: no se renombra a la ligera.
  clave       text not null unique,
  nombre      text not null,
  unidad      text not null default 'pieza',
  -- Null = no hay ficha en el catálogo: se lleva el saldo y nada más.
  producto_id uuid references public.products(id) on delete set null,
  -- Umbral para la pastilla roja: «a Eduardo le quedan 3 palancas negras».
  minimo      numeric(12,2) not null default 0 check (minimo >= 0),
  activo      boolean not null default true,
  notas       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.maquila_insumos is
  'Catálogo de lo que Fresa Fit le manda a Eduardo en consignación (palancas, muñequeras, straps). `clave` es contrato con el trigger de consumo y con lib/maquila/consignacion.ts.';
comment on column public.maquila_insumos.producto_id is
  'Ficha del catálogo, si la hay. Con ficha, enviarle piezas descuenta products.stock; sin ficha (las palancas hoy) solo se lleva el saldo.';

create index if not exists maquila_insumos_producto_idx   on public.maquila_insumos (producto_id);
create index if not exists maquila_insumos_created_by_idx on public.maquila_insumos (created_by);

drop trigger if exists maquila_insumos_touch_trg on public.maquila_insumos;
create trigger maquila_insumos_touch_trg
  before update on public.maquila_insumos
  for each row execute function public.maquila_touch();

-- ---------------------------------------------------------------------------
-- El saldo. Una fila por insumo, escrita SOLO por las RPC.
--
-- Sin `check (saldo >= 0)` a propósito: si Eduardo mandó una pieza con una
-- palanca que el CRM creía agotada, el descuadre es del conteo, no del envío.
-- Bloquear su «enviado» por un inventario mal llevado sería el peor error
-- posible del módulo; la señal correcta es la pastilla en rojo.
-- ---------------------------------------------------------------------------
create table if not exists public.maquila_consignacion (
  insumo_id  uuid primary key references public.maquila_insumos(id) on delete cascade,
  saldo      numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.maquila_consignacion is
  'Saldo de cada insumo en poder de Eduardo. Puede quedar NEGATIVO a propósito: un descuadre de conteo nunca debe frenar un envío. Solo escriben las RPC de maquila.';

-- Los cuatro que existen hoy. `on conflict do nothing`: correr esto dos veces
-- no duplica ni pisa lo que ya se editó desde la pantalla.
insert into public.maquila_insumos (clave, nombre, unidad, minimo) values
  ('palanca_plateada', 'Palanca plateada', 'pieza', 5),
  ('palanca_negra',    'Palanca negra',    'pieza', 5),
  ('munequeras',       'Muñequeras (par)', 'par',   5),
  ('straps',           'Straps (par)',     'par',   5)
on conflict (clave) do nothing;

insert into public.maquila_consignacion (insumo_id, saldo)
  select id, 0 from public.maquila_insumos
on conflict (insumo_id) do nothing;

-- ---------------------------------------------------------------------------
-- Permisos + RLS.
--   Interno y maquilero: ven el catálogo y el saldo (él necesita saber con
--   cuántas palancas cuenta; es material suyo en resguardo, no dinero).
--   Gestionar el catálogo: administración.
--   Escribir el saldo: NADIE por SQL directo — solo las RPC (definer).
-- ---------------------------------------------------------------------------
grant all on public.maquila_insumos to authenticated, service_role;
grant all on public.maquila_consignacion to authenticated, service_role;

alter table public.maquila_insumos enable row level security;
alter table public.maquila_consignacion enable row level security;

drop policy if exists "maquila insumos: ver (interno)" on public.maquila_insumos;
create policy "maquila insumos: ver (interno)" on public.maquila_insumos
  for select to authenticated using ((select public.es_interno()));

drop policy if exists "maquila insumos: ver (maquilero)" on public.maquila_insumos;
create policy "maquila insumos: ver (maquilero)" on public.maquila_insumos
  for select to authenticated using ((select public.es_maquilero()));

drop policy if exists "maquila insumos: gestionar (admin)" on public.maquila_insumos;
create policy "maquila insumos: gestionar (admin)" on public.maquila_insumos
  for all to authenticated
  using ((select public.es_administrativo()))
  with check ((select public.es_administrativo()));

drop policy if exists "maquila consignacion: ver (interno)" on public.maquila_consignacion;
create policy "maquila consignacion: ver (interno)" on public.maquila_consignacion
  for select to authenticated using ((select public.es_interno()));

drop policy if exists "maquila consignacion: ver (maquilero)" on public.maquila_consignacion;
create policy "maquila consignacion: ver (maquilero)" on public.maquila_consignacion
  for select to authenticated using ((select public.es_maquilero()));

revoke insert, update, delete on public.maquila_consignacion from authenticated, anon;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select clave, nombre, minimo, producto_id from public.maquila_insumos order by clave;
--     -- 4 renglones, producto_id null hasta que se liguen fichas
--   select i.clave, c.saldo from public.maquila_consignacion c
--     join public.maquila_insumos i on i.id = c.insumo_id order by 1;   -- todos en 0
--   select policyname from pg_policies where tablename = 'maquila_consignacion';
--     -- solo las dos de select: el saldo no se escribe a mano
-- ============================================================================
