-- ============================================================================
-- Fresafit CRM — Lote de operación en `stock_log`
-- ----------------------------------------------------------------------------
-- Una sola operación (una corrida de sincronización, una recepción de pedido)
-- escribe MUCHOS renglones de golpe. Como el timestamp lo pone `now()` —que en
-- Postgres es constante dentro de una misma transacción—, todos esos renglones
-- quedaban con el mismo `creado_en` y en el historial se veían como N cambios
-- sueltos a la misma hora, confundiendo a quien audita.
--
-- `lote` marca con un mismo id todos los renglones que una operación insertó
-- juntos, para que la pantalla los muestre como un solo bloque. Es NULL en los
-- movimientos viejos (previos a esta columna) y en los que no pasan por el
-- registrador (ahí la UI cae a su heurística temporal).
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.stock_log add column if not exists lote uuid;

create index if not exists stock_log_lote_idx on public.stock_log(lote);

-- ----------------------------------------------------------------------------
-- Recepción de pedido a proveedor: sella todas las sumas de la misma recepción
-- con un solo lote (una recepción puede tocar varios productos a la vez).
-- (Reemplaza la versión de 20260720; misma firma y semántica + lote.)
-- ----------------------------------------------------------------------------
create or replace function public.recibir_pedido_proveedor(pid uuid, sumar_stock boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_lote uuid := gen_random_uuid();
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
    insert into public.stock_log (producto_id, canal, origen, stock_anterior, stock_nuevo, lote)
      select id, 'crm', 'proveedor', nuevo - total, nuevo, v_lote from actualizados;
  end if;
end;
$$;
grant execute on function public.recibir_pedido_proveedor(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
