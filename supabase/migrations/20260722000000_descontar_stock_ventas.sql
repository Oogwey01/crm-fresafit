-- ============================================================================
-- Fresafit CRM — Descuento de stock por venta (hub padre-hijo)
-- ----------------------------------------------------------------------------
-- Modelo objetivo: Tienda Nube es el inventario padre. Una venta en un canal
-- hijo (Mercado Libre; TikTok en fase 2) descuenta el stock del CRM y luego se
-- propaga a los demás canales. Esta función hace el descuento atómico y deja el
-- rastro en `stock_log`; la propagación a los otros canales la hace la app.
--
-- La dispara la importación de ventas SOLO con el flag STOCK_HUB_VENTAS activo
-- (lib/inventario/hub-config.ts). Idempotencia: la app solo pasa las ventas
-- NUEVAS (las que el UNIQUE de `sales` dejó insertar), así reintentos de webhook
-- o cron no vuelven a descontar.
--
-- Idempotente (create or replace): se puede pegar tal cual en el SQL Editor.
-- ============================================================================

create or replace function public.descontar_stock_ventas(items jsonb, p_origen text)
returns table (
  id                    uuid,
  stock                 int,
  tiendanube_product_id bigint,
  tiendanube_variant_id bigint,
  meli_item_id          text,
  meli_variation_id     bigint
) language plpgsql security definer set search_path = public as $$
begin
  return query
  -- Suma cantidades por producto (un mismo producto puede venir en varias líneas).
  with ent as (
    select x.producto_id, sum(x.cantidad)::int as cantidad
      from jsonb_to_recordset(items) as x(producto_id uuid, cantidad int)
     where x.producto_id is not null and x.cantidad > 0
     group by x.producto_id
  ),
  -- Valor previo (snapshot pre-update) para el ledger.
  antes as (
    select p.id, p.stock as anterior, e.cantidad
      from public.products p
      join ent e on e.producto_id = p.id
  ),
  upd as (
    update public.products p
       set stock = greatest(0, p.stock - e.cantidad)
      from ent e
     where p.id = e.producto_id
    returning p.id, p.stock as nuevo,
              p.tiendanube_product_id, p.tiendanube_variant_id,
              p.meli_item_id, p.meli_variation_id
  ),
  -- CTE modificadora: siempre corre a término aunque no se referencie.
  logged as (
    insert into public.stock_log (producto_id, canal, origen, stock_anterior, stock_nuevo)
      select u.id, 'crm', p_origen, a.anterior, u.nuevo
        from upd u
        join antes a on a.id = u.id
    returning 1
  )
  select u.id, u.nuevo, u.tiendanube_product_id, u.tiendanube_variant_id,
         u.meli_item_id, u.meli_variation_id
    from upd u;
end;
$$;

grant execute on function public.descontar_stock_ventas(jsonb, text) to service_role;

notify pgrst, 'reload schema';
