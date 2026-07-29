-- ============================================================================
-- 20260731000000_proveedores_reconciliacion.sql — Fase 3 (junta)
-- ----------------------------------------------------------------------------
-- Proveedores + seguimiento de pedidos + reconciliación:
--   * suppliers: país y contacto.
--   * supplier_orders: rastreo (paquetería, guía, link).
--   * supplier_order_payments  — pagos del pedido (con comprobante).
--   * supplier_order_incidents — incidencias por pedido.
--   * conteos_fisicos          — conteos de inventario (quién contó / corroboró).
--   * reconciliacion_snapshots — última corrida guardada (carga instantánea).
--   * bucket `pedidos-proveedor` para los comprobantes de pago.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 3.1 Proveedores: país y contacto (chino/mexicano, persona/WeChat, etc.)
-- ---------------------------------------------------------------------------
alter table public.suppliers add column if not exists pais     text;
alter table public.suppliers add column if not exists contacto text;

-- ---------------------------------------------------------------------------
-- 3.2 Pedidos: rastreo directo en el pedido (una guía principal).
-- ---------------------------------------------------------------------------
alter table public.supplier_orders add column if not exists paqueteria  text;
alter table public.supplier_orders add column if not exists num_guia    text;
alter table public.supplier_orders add column if not exists url_rastreo text;

-- ---------------------------------------------------------------------------
-- 3.2 Pagos de un pedido (fecha, monto, comprobante opcional).
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_order_payments (
  id                  uuid primary key default gen_random_uuid(),
  pedido_id           uuid not null references public.supplier_orders(id) on delete cascade,
  fecha               date not null default current_date,
  monto               numeric(12,2) not null check (monto >= 0),
  nota                text,
  comprobante_path    text,   -- ruta en el bucket `pedidos-proveedor` (opcional)
  comprobante_nombre  text,
  comprobante_tipo    text,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists sop_pedido_idx on public.supplier_order_payments(pedido_id);

-- ---------------------------------------------------------------------------
-- 3.2 Incidencias de un pedido (qué pasó, resuelta o no).
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_order_incidents (
  id          uuid primary key default gen_random_uuid(),
  pedido_id   uuid not null references public.supplier_orders(id) on delete cascade,
  fecha       date not null default current_date,
  texto       text not null,
  resuelto    boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists soi_pedido_idx on public.supplier_order_incidents(pedido_id);

-- ---------------------------------------------------------------------------
-- 3.4 Conteos físicos de inventario (quién contó, quién corroboró).
-- ---------------------------------------------------------------------------
create table if not exists public.conteos_fisicos (
  id              uuid primary key default gen_random_uuid(),
  producto_id     uuid references public.products(id) on delete set null,
  descripcion     text,        -- por si el producto no está en catálogo
  cantidad        int not null check (cantidad >= 0),
  contado_por     text,        -- nombre libre (p. ej. Emiliano)
  corroborado_por text,        -- nombre libre (p. ej. Germán)
  nota            text,
  fecha           date not null default current_date,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists conteos_producto_idx on public.conteos_fisicos(producto_id);
create index if not exists conteos_fecha_idx     on public.conteos_fisicos(fecha desc);

-- ---------------------------------------------------------------------------
-- 3.3 Snapshot de la reconciliación (una sola fila; se sobreescribe).
-- ---------------------------------------------------------------------------
create table if not exists public.reconciliacion_snapshots (
  id        text primary key default 'actual',
  resumen   jsonb not null,
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Permisos + RLS (matriz interna: ver/crear/editar interno; borrar gestor).
-- ---------------------------------------------------------------------------
grant all on
  public.supplier_order_payments,
  public.supplier_order_incidents,
  public.conteos_fisicos,
  public.reconciliacion_snapshots
  to authenticated, service_role;

alter table public.supplier_order_payments  enable row level security;
alter table public.supplier_order_incidents enable row level security;
alter table public.conteos_fisicos          enable row level security;
alter table public.reconciliacion_snapshots enable row level security;

-- pagos
drop policy if exists "pagos pedido: ver (interno)" on public.supplier_order_payments;
create policy "pagos pedido: ver (interno)" on public.supplier_order_payments
  for select to authenticated using (public.es_interno());
drop policy if exists "pagos pedido: gestionar (interno)" on public.supplier_order_payments;
create policy "pagos pedido: gestionar (interno)" on public.supplier_order_payments
  for all to authenticated using (public.es_interno()) with check (public.es_interno());

-- incidencias
drop policy if exists "incidencias pedido: ver (interno)" on public.supplier_order_incidents;
create policy "incidencias pedido: ver (interno)" on public.supplier_order_incidents
  for select to authenticated using (public.es_interno());
drop policy if exists "incidencias pedido: gestionar (interno)" on public.supplier_order_incidents;
create policy "incidencias pedido: gestionar (interno)" on public.supplier_order_incidents
  for all to authenticated using (public.es_interno()) with check (public.es_interno());

-- conteos físicos
drop policy if exists "conteos: ver (interno)" on public.conteos_fisicos;
create policy "conteos: ver (interno)" on public.conteos_fisicos
  for select to authenticated using (public.es_interno());
drop policy if exists "conteos: gestionar (interno)" on public.conteos_fisicos;
create policy "conteos: gestionar (interno)" on public.conteos_fisicos
  for all to authenticated using (public.es_interno()) with check (public.es_interno());

-- snapshot de reconciliación (lo escribe el usuario interno o el cron service_role)
drop policy if exists "reconciliacion snapshot: ver (interno)" on public.reconciliacion_snapshots;
create policy "reconciliacion snapshot: ver (interno)" on public.reconciliacion_snapshots
  for select to authenticated using (public.es_interno());
drop policy if exists "reconciliacion snapshot: gestionar (interno)" on public.reconciliacion_snapshots;
create policy "reconciliacion snapshot: gestionar (interno)" on public.reconciliacion_snapshots
  for all to authenticated using (public.es_interno()) with check (public.es_interno());

-- ---------------------------------------------------------------------------
-- Storage: bucket privado para los comprobantes de pago a proveedor.
-- Ruta: pedidos-proveedor/<pedido_id>/<archivo>.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('pedidos-proveedor', 'pedidos-proveedor', false)
  on conflict (id) do nothing;

drop policy if exists "pedidos-prov storage: ver" on storage.objects;
create policy "pedidos-prov storage: ver" on storage.objects
  for select to authenticated
  using (bucket_id = 'pedidos-proveedor' and public.es_interno());

drop policy if exists "pedidos-prov storage: subir" on storage.objects;
create policy "pedidos-prov storage: subir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pedidos-proveedor' and public.es_interno());

drop policy if exists "pedidos-prov storage: borrar" on storage.objects;
create policy "pedidos-prov storage: borrar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pedidos-proveedor' and public.es_interno());

notify pgrst, 'reload schema';
