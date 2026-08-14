-- ============================================================================
-- Pedidos a proveedor: lo que pidió Armando en la junta del 13/08/2026.
-- «Manual y básico primero, optimizar después.»
--
--   * supplier_orders gana:
--       - tipo_envio           aereo / maritimo_express / maritimo_normal
--       - pago_intl_nota       el texto largo de la transferencia internacional
--       - costo_extra_pct      el % que cuesta pagar desde México (conversión,
--                              comisiones), manual — nada de tipo de cambio
--                              adivinado
--       - costo_extra_nota     o la nota libre del costo extra
--       - divisa_origen        en qué moneda cobra el proveedor (USD default)
--   * supplier_order_trackings — VARIOS tracking numbers por pedido, cada uno
--     con qué contiene («no todo se envía en un tracking number»). Backfill
--     desde las columnas viejas del pedido, que se CONSERVAN por compatibilidad
--     pero la UI deja de escribirlas. OJO: retirarlas en una migración futura.
--   * supplier_order_files — archivos del pedido sobre el bucket que ya existe
--     (`pedidos-proveedor`): factura de China, screenshot del pago
--     internacional, fotos que manda el proveedor («tengo como 50 fotos»).
--   * supplier_order_payments gana monto_origen/divisa: cuánto fue en la
--     moneda del proveedor, además del MXN real que salió de la cuenta (monto).
--
-- El costo real del pedido = Σ pagos en MXN; el costo China = Σ renglones en
-- divisa_origen. La pantalla los enseña lado a lado, sin convertir.
--
-- RLS: mismas políticas «solo dirección» (es_admin) que el resto del módulo
-- (ver 20260823000000_proveedores_solo_direccion.sql). El bucket ya tiene sus
-- políticas de storage (20260731000000). Idempotente.
-- ============================================================================

set lock_timeout = '10s';

-- 1. Columnas nuevas del pedido -----------------------------------------------

alter table public.supplier_orders
  add column if not exists tipo_envio text
    check (tipo_envio is null or tipo_envio in ('aereo','maritimo_express','maritimo_normal'));

alter table public.supplier_orders
  add column if not exists pago_intl_nota text;

alter table public.supplier_orders
  add column if not exists costo_extra_pct numeric(6,2)
    check (costo_extra_pct is null or costo_extra_pct >= 0);

alter table public.supplier_orders
  add column if not exists costo_extra_nota text;

alter table public.supplier_orders
  add column if not exists divisa_origen text not null default 'USD';

-- 2. Varios trackings por pedido ----------------------------------------------

create table if not exists public.supplier_order_trackings (
  id          uuid primary key default gen_random_uuid(),
  pedido_id   uuid not null references public.supplier_orders(id) on delete cascade,
  paqueteria  text,
  num_guia    text not null,
  url_rastreo text,
  -- Qué viene en ESTA guía («los straps y 20 cinturones»), texto libre.
  contenido   text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists sot_pedido_idx on public.supplier_order_trackings(pedido_id);

-- Backfill: la guía única que ya estaba capturada pasa a ser el primer
-- tracking. Idempotente: solo si el pedido aún no tiene ninguno.
insert into public.supplier_order_trackings (pedido_id, paqueteria, num_guia, url_rastreo)
select o.id, o.paqueteria, o.num_guia, o.url_rastreo
  from public.supplier_orders o
 where o.num_guia is not null
   and btrim(o.num_guia) <> ''
   and not exists (
     select 1 from public.supplier_order_trackings t where t.pedido_id = o.id
   );

-- 3. Archivos del pedido ------------------------------------------------------

create table if not exists public.supplier_order_files (
  id          uuid primary key default gen_random_uuid(),
  pedido_id   uuid not null references public.supplier_orders(id) on delete cascade,
  -- factura (la de China), pago_internacional (el screenshot de la
  -- transferencia), foto_proveedor (lo que va a mandar), otro.
  tipo        text not null default 'otro'
                check (tipo in ('factura','pago_internacional','foto_proveedor','otro')),
  storage_path text not null,
  nombre      text,
  mime        text,
  nota        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists sof_pedido_idx on public.supplier_order_files(pedido_id, tipo);

-- 4. Pagos: cuánto fue en la moneda del proveedor -----------------------------

alter table public.supplier_order_payments
  add column if not exists monto_origen numeric(12,2)
    check (monto_origen is null or monto_origen >= 0);

alter table public.supplier_order_payments
  add column if not exists divisa text;

-- 5. Permisos + RLS (solo dirección, como el resto del módulo) ----------------

grant all on
  public.supplier_order_trackings,
  public.supplier_order_files
  to authenticated, service_role;

alter table public.supplier_order_trackings enable row level security;
alter table public.supplier_order_files     enable row level security;

drop policy if exists "trackings pedido: ver (direccion)" on public.supplier_order_trackings;
create policy "trackings pedido: ver (direccion)" on public.supplier_order_trackings
  for select to authenticated using (public.es_admin(auth.uid()));
drop policy if exists "trackings pedido: gestionar (direccion)" on public.supplier_order_trackings;
create policy "trackings pedido: gestionar (direccion)" on public.supplier_order_trackings
  for all to authenticated
  using (public.es_admin(auth.uid())) with check (public.es_admin(auth.uid()));

drop policy if exists "archivos pedido: ver (direccion)" on public.supplier_order_files;
create policy "archivos pedido: ver (direccion)" on public.supplier_order_files
  for select to authenticated using (public.es_admin(auth.uid()));
drop policy if exists "archivos pedido: gestionar (direccion)" on public.supplier_order_files;
create policy "archivos pedido: gestionar (direccion)" on public.supplier_order_files
  for all to authenticated
  using (public.es_admin(auth.uid())) with check (public.es_admin(auth.uid()));

notify pgrst, 'reload schema';
