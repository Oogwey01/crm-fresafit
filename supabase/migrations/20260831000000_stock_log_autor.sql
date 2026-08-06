-- ============================================================================
-- Fresafit CRM — Quién movió el inventario (`stock_log.created_by`)
-- ----------------------------------------------------------------------------
-- El ledger ya decía QUÉ producto se movió, DE cuánto A cuánto, por qué CANAL y
-- qué lo ORIGINÓ, pero no QUIÉN. Un ajuste manual de +30 piezas se veía igual lo
-- hiciera quien lo hiciera, y una sincronización disparada a mano no se
-- distinguía de la del cron de las 6:00.
--
-- `created_by` es el mismo patrón que ya usa `insumo_movimientos` en bodega: FK
-- a `profiles`, NULL cuando de verdad no hubo persona detrás (ventas por webhook
-- y crons). Es NULL también en todo lo anterior a esta migración: la autoría no
-- se puede reconstruir hacia atrás, empieza a acumularse desde aquí.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.stock_log
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

create index if not exists stock_log_autor_idx on public.stock_log(created_by, creado_en desc);

-- Nadie puede firmar a nombre de otro. El service role salta la RLS, así que
-- esto no toca a los registros que escriben las sincronizaciones y los webhooks
-- (los que sí traen actor lo ponen desde el servidor, no desde el navegador).
drop policy if exists "stock log: registrar (interno)" on public.stock_log;
create policy "stock log: registrar (interno)" on public.stock_log
  for insert to authenticated
  with check (public.es_interno() and (created_by is null or created_by = auth.uid()));

-- ----------------------------------------------------------------------------
-- Las dos funciones que insertan en el ledger DESDE UNA SESIÓN REAL: ahí la
-- autoría sale gratis con `auth.uid()`, sin tocar el TypeScript que las llama.
-- Las de ventas (`descontar_stock_ventas`, `devolver_stock_ventas`) NO se
-- tocan: se invocan con el service role desde los webhooks, donde `auth.uid()`
-- es NULL por definición.
-- ----------------------------------------------------------------------------

-- Recepción de pedido a proveedor.
-- (Reemplaza la versión de 20260802; misma firma y semántica + autor.)
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
    insert into public.stock_log (producto_id, canal, origen, stock_anterior, stock_nuevo, lote, created_by)
      select id, 'crm', 'proveedor', nuevo - total, nuevo, v_lote, auth.uid() from actualizados;
  end if;
end;
$$;
grant execute on function public.recibir_pedido_proveedor(uuid, boolean) to authenticated;

-- Descontar un renglón de recepción de bodega. La versión por lote
-- (`descontar_recepcion_lote`) llama a ésta en bucle, así que la carga masiva
-- del piso queda firmada también.
-- (Reemplaza la versión de 20260821; misma firma y semántica + autor.)
create or replace function public.descontar_recepcion(iid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  fila public.recepcion_items;
  antes int;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede mover el inventario.';
  end if;

  -- El lock evita la carrera de dos descuentos simultáneos del mismo renglón.
  select * into fila from public.recepcion_items where id = iid for update;
  if not found then
    raise exception 'Ese renglón de recepción ya no existe.';
  end if;
  if fila.estado = 'descontado' then
    return;  -- ya se aplicó; no-op
  end if;

  if fila.producto_id is not null and fila.unidades_no_procesadas > 0 then
    select stock into antes from public.products where id = fila.producto_id for update;
    update public.products
       set stock = stock + fila.unidades_no_procesadas
     where id = fila.producto_id;
    insert into public.stock_log (producto_id, canal, origen, stock_anterior, stock_nuevo, created_by)
      values (fila.producto_id, 'crm', 'recepcion_bodega', antes,
              antes + fila.unidades_no_procesadas, auth.uid());
  end if;

  update public.recepcion_items
     set estado = 'descontado', descontado_en = now(), updated_at = now()
   where id = iid;
end;
$$;
grant execute on function public.descontar_recepcion(uuid) to authenticated;

notify pgrst, 'reload schema';
