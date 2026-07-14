-- ============================================================================
-- Fresafit CRM — Fase 2: Ventas y métricas
-- ----------------------------------------------------------------------------
-- Una sola tabla `sales`: un renglón = un producto vendido. Alimenta Métricas
-- (F2), Finanzas (F3, entradas), Clientes (F4, historial) y Pedidos (F5, que
-- solo agrega columnas de envío sobre estas MISMAS filas). Capturar un pedido
-- ES capturar la venta: nunca doble captura.
--   * origen: manual (capturada a mano), csv (importada de archivo),
--     api (traída de la plataforma: Tienda Nube / Mercado Libre / TikTok).
--   * referencia_externa: id del renglón/orden en la plataforma; el UNIQUE
--     parcial (canal, referencia_externa) hace idempotentes las importaciones
--     (webhook + cron + botón pueden correr juntos sin duplicar).
-- Reemplaza a la tabla esqueleto `orders` (vacía).
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

drop table if exists public.orders;

create table if not exists public.sales (
  id                  uuid primary key default gen_random_uuid(),
  fecha               date not null default current_date,
  canal               text not null default 'punto_fisico'
                      check (canal in ('tienda_nube','tiktok_shop','mercado_libre','punto_fisico','otro')),
  producto_id         uuid references public.products(id) on delete set null,
  descripcion         text,                 -- respaldo si el producto no está en el catálogo
  cantidad            int not null default 1 check (cantidad > 0),
  monto               numeric(12,2) not null default 0 check (monto >= 0),  -- total del renglón
  cliente_id          uuid references public.customers(id) on delete set null,
  origen              text not null default 'manual' check (origen in ('manual','csv','api')),
  referencia_externa  text,                 -- p. ej. "<order_id>:<variant_id>" de Tienda Nube
  notas               text,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

create index if not exists sales_fecha_idx    on public.sales(fecha);
create index if not exists sales_canal_idx    on public.sales(canal);
create index if not exists sales_producto_idx on public.sales(producto_id);
create index if not exists sales_cliente_idx  on public.sales(cliente_id);
-- Sin WHERE: PostgREST infiere el índice en upserts (ON CONFLICT) solo si no es
-- parcial. Los NULL de las ventas manuales no chocan entre sí (NULL ≠ NULL).
create unique index if not exists sales_ref_externa_uidx
  on public.sales(canal, referencia_externa);

drop trigger if exists sales_touch on public.sales;
create trigger sales_touch
  before update on public.sales
  for each row execute function public.touch_updated_at();

-- Permisos + RLS (matriz común de módulos de negocio).
grant all on public.sales to authenticated, service_role;

alter table public.sales enable row level security;

drop policy if exists "ventas: ver (interno)" on public.sales;
create policy "ventas: ver (interno)" on public.sales
  for select to authenticated using (public.es_interno());
drop policy if exists "ventas: crear (interno)" on public.sales;
create policy "ventas: crear (interno)" on public.sales
  for insert to authenticated with check (public.es_interno() and created_by = auth.uid());
drop policy if exists "ventas: editar (interno)" on public.sales;
create policy "ventas: editar (interno)" on public.sales
  for update to authenticated using (public.es_interno()) with check (public.es_interno());
drop policy if exists "ventas: borrar (gestor)" on public.sales;
create policy "ventas: borrar (gestor)" on public.sales
  for delete to authenticated using (public.es_gestor());

notify pgrst, 'reload schema';
