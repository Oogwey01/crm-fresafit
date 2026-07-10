-- ============================================================================
-- Fresafit CRM — Fase 1: Inventario y proveedores
-- ----------------------------------------------------------------------------
-- Reemplaza la tabla esqueleto `inventory` por el modelo real:
--   * suppliers            — proveedores (Nancy, Amy, Gina) con sus datos.
--   * products             — productos por tipo/variante, costo, precio y stock.
--   * supplier_orders      — pedidos a proveedor (ETA, estado incl. aduana).
--   * supplier_order_items — renglones de cada pedido.
-- RLS: todo el equipo interno ve y captura; borrar es de gestores. `externo`
-- no ve nada de los módulos de negocio.
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- Helper: ¿el usuario es del equipo interno? (dirección/coordinador/miembro).
-- Es la base de las policies de TODOS los módulos de negocio (Fases 1–5).
create or replace function public.es_interno()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and rol in ('direccion','coordinador','miembro')
  );
$$;
grant execute on function public.es_interno() to authenticated;

-- La esqueleto `inventory` está vacía (solo id + auditoría); fuera con ella.
drop table if exists public.inventory;

-- ----------------------------------------------------------------------------
-- suppliers: proveedores.
-- ----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  telefono   text,
  correo     text,
  notas      text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

drop trigger if exists suppliers_touch on public.suppliers;
create trigger suppliers_touch
  before update on public.suppliers
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- products: catálogo de productos con stock.
-- ----------------------------------------------------------------------------
create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  tipo         text not null default 'otro'
               check (tipo in ('cinturones','straps','munequeras','mochilas','ropa','otro')),
  variante     text,                       -- libre: "Rosa / M"
  costo        numeric(10,2) check (costo >= 0),      -- lo que nos cuesta
  precio       numeric(10,2) check (precio >= 0),     -- precio de venta
  stock        int not null default 0 check (stock >= 0),
  stock_minimo int not null default 5 check (stock_minimo >= 0),
  proveedor_id uuid references public.suppliers(id) on delete set null,
  activo       boolean not null default true,
  notas        text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

create index if not exists products_tipo_idx      on public.products(tipo);
create index if not exists products_proveedor_idx on public.products(proveedor_id);

drop trigger if exists products_touch on public.products;
create trigger products_touch
  before update on public.products
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- supplier_orders + supplier_order_items: pedidos a proveedor.
-- ----------------------------------------------------------------------------
create table if not exists public.supplier_orders (
  id             uuid primary key default gen_random_uuid(),
  proveedor_id   uuid not null references public.suppliers(id) on delete cascade,
  fecha_pedido   date not null default current_date,
  fecha_estimada date,                     -- cuándo llega (ETA)
  estado         text not null default 'pedido'
                 check (estado in ('pedido','en_transito','en_aduana','recibido','cancelado')),
  costo_total    numeric(12,2) check (costo_total >= 0),
  notas          text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);

create index if not exists supplier_orders_estado_idx on public.supplier_orders(estado);

drop trigger if exists supplier_orders_touch on public.supplier_orders;
create trigger supplier_orders_touch
  before update on public.supplier_orders
  for each row execute function public.touch_updated_at();

create table if not exists public.supplier_order_items (
  id             uuid primary key default gen_random_uuid(),
  pedido_id      uuid not null references public.supplier_orders(id) on delete cascade,
  producto_id    uuid references public.products(id) on delete set null,
  descripcion    text,                     -- para productos aún no dados de alta
  cantidad       int not null check (cantidad > 0),
  costo_unitario numeric(10,2) check (costo_unitario >= 0)
);

create index if not exists supplier_order_items_pedido_idx on public.supplier_order_items(pedido_id);

-- ----------------------------------------------------------------------------
-- Recibir un pedido: marca `recibido` y (opcional) suma los renglones al stock.
-- Función atómica para que "marcar recibido + sumar stock" no quede a medias.
-- Es la única semi-automatización del módulo y siempre la dispara un botón.
-- ----------------------------------------------------------------------------
create or replace function public.recibir_pedido_proveedor(pid uuid, sumar_stock boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede recibir pedidos.';
  end if;
  update public.supplier_orders set estado = 'recibido' where id = pid;
  if sumar_stock then
    update public.products p
       set stock = p.stock + i.total
      from (
        select producto_id, sum(cantidad) as total
          from public.supplier_order_items
         where pedido_id = pid and producto_id is not null
         group by producto_id
      ) i
     where p.id = i.producto_id;
  end if;
end;
$$;
grant execute on function public.recibir_pedido_proveedor(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- Permisos + RLS (matriz común de módulos de negocio):
--   SELECT / INSERT / UPDATE → equipo interno; DELETE → gestores.
-- ----------------------------------------------------------------------------
grant all on public.suppliers, public.products, public.supplier_orders, public.supplier_order_items
  to authenticated, service_role;

alter table public.suppliers            enable row level security;
alter table public.products             enable row level security;
alter table public.supplier_orders      enable row level security;
alter table public.supplier_order_items enable row level security;

-- suppliers
drop policy if exists "proveedores: ver (interno)" on public.suppliers;
create policy "proveedores: ver (interno)" on public.suppliers
  for select to authenticated using (public.es_interno());
drop policy if exists "proveedores: crear (interno)" on public.suppliers;
create policy "proveedores: crear (interno)" on public.suppliers
  for insert to authenticated with check (public.es_interno() and created_by = auth.uid());
drop policy if exists "proveedores: editar (interno)" on public.suppliers;
create policy "proveedores: editar (interno)" on public.suppliers
  for update to authenticated using (public.es_interno()) with check (public.es_interno());
drop policy if exists "proveedores: borrar (gestor)" on public.suppliers;
create policy "proveedores: borrar (gestor)" on public.suppliers
  for delete to authenticated using (public.es_gestor());

-- products
drop policy if exists "productos: ver (interno)" on public.products;
create policy "productos: ver (interno)" on public.products
  for select to authenticated using (public.es_interno());
drop policy if exists "productos: crear (interno)" on public.products;
create policy "productos: crear (interno)" on public.products
  for insert to authenticated with check (public.es_interno() and created_by = auth.uid());
drop policy if exists "productos: editar (interno)" on public.products;
create policy "productos: editar (interno)" on public.products
  for update to authenticated using (public.es_interno()) with check (public.es_interno());
drop policy if exists "productos: borrar (gestor)" on public.products;
create policy "productos: borrar (gestor)" on public.products
  for delete to authenticated using (public.es_gestor());

-- supplier_orders
drop policy if exists "pedidos prov: ver (interno)" on public.supplier_orders;
create policy "pedidos prov: ver (interno)" on public.supplier_orders
  for select to authenticated using (public.es_interno());
drop policy if exists "pedidos prov: crear (interno)" on public.supplier_orders;
create policy "pedidos prov: crear (interno)" on public.supplier_orders
  for insert to authenticated with check (public.es_interno() and created_by = auth.uid());
drop policy if exists "pedidos prov: editar (interno)" on public.supplier_orders;
create policy "pedidos prov: editar (interno)" on public.supplier_orders
  for update to authenticated using (public.es_interno()) with check (public.es_interno());
drop policy if exists "pedidos prov: borrar (gestor)" on public.supplier_orders;
create policy "pedidos prov: borrar (gestor)" on public.supplier_orders
  for delete to authenticated using (public.es_gestor());

-- supplier_order_items (viven y mueren con su pedido)
drop policy if exists "items pedido prov: ver (interno)" on public.supplier_order_items;
create policy "items pedido prov: ver (interno)" on public.supplier_order_items
  for select to authenticated using (public.es_interno());
drop policy if exists "items pedido prov: gestionar (interno)" on public.supplier_order_items;
create policy "items pedido prov: gestionar (interno)" on public.supplier_order_items
  for all to authenticated using (public.es_interno()) with check (public.es_interno());

notify pgrst, 'reload schema';
