-- ============================================================================
-- Fresafit CRM — Auditoría de stock (`stock_log`)
-- ----------------------------------------------------------------------------
-- Ledger append-only: cada escritura de stock deja rastro de qué producto, de
-- qué valor a qué valor, por qué canal se escribió y qué la originó. Nace a
-- raíz de que la sync de Mercado Libre sobrescribía el stock de Tienda Nube sin
-- dejar huella: con esto se puede saber siempre qué artículo se modificó y por
-- qué vía.
--
--   canal  = dónde impactó la escritura: crm (base local) | tienda_nube |
--            mercado_libre (empuje saliente a ese canal).
--   origen = qué la disparó: manual | tiendanube_sync | mercadolibre_sync |
--            proveedor | ...
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

create table if not exists public.stock_log (
  id             bigint generated always as identity primary key,
  producto_id    uuid references public.products(id) on delete set null,
  canal          text not null check (canal in ('crm','tienda_nube','mercado_libre')),
  origen         text not null,
  stock_anterior int,
  stock_nuevo    int not null,
  creado_en      timestamptz not null default now()
);

create index if not exists stock_log_producto_idx on public.stock_log(producto_id, creado_en desc);
create index if not exists stock_log_creado_idx   on public.stock_log(creado_en desc);

grant all on public.stock_log to authenticated, service_role;
alter table public.stock_log enable row level security;

-- Solo lectura para el equipo interno; el alta la hacen las acciones/sync
-- (service_role la salta; el ajuste manual la escribe con el user client).
-- Es un ledger: no se edita ni se borra desde la app (sin policies update/delete).
drop policy if exists "stock log: ver (interno)" on public.stock_log;
create policy "stock log: ver (interno)" on public.stock_log
  for select to authenticated using (public.es_interno());

drop policy if exists "stock log: registrar (interno)" on public.stock_log;
create policy "stock log: registrar (interno)" on public.stock_log
  for insert to authenticated with check (public.es_interno());

-- ----------------------------------------------------------------------------
-- Recepción de pedido a proveedor: además de sumar el stock, deja el rastro.
-- (Reemplaza la versión de 20250103; misma firma y semántica + logging.)
-- ----------------------------------------------------------------------------
create or replace function public.recibir_pedido_proveedor(pid uuid, sumar_stock boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede recibir pedidos.';
  end if;
  update public.supplier_orders set estado = 'recibido' where id = pid;
  if sumar_stock then
    with sumas as (
      select producto_id, sum(cantidad) as total
        from public.supplier_order_items
       where pedido_id = pid and producto_id is not null
       group by producto_id
    ),
    actualizados as (
      update public.products p
         set stock = p.stock + s.total
        from sumas s
       where p.id = s.producto_id
      returning p.id, p.stock as nuevo, s.total
    )
    insert into public.stock_log (producto_id, canal, origen, stock_anterior, stock_nuevo)
      select id, 'crm', 'proveedor', nuevo - total, nuevo from actualizados;
  end if;
end;
$$;
grant execute on function public.recibir_pedido_proveedor(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
