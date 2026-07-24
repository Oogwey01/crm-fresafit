-- ============================================================================
-- Fresafit CRM — Devolución de stock por venta cancelada
-- ----------------------------------------------------------------------------
-- Espejo de descontar_stock_ventas. Cuando una orden se cancela o se reembolsa,
-- el canal donde se vendió devuelve la unidad a su propio stock (Tienda Nube y
-- Mercado Libre lo hacen solos). Hasta ahora el CRM solo borraba el renglón de
-- `sales` y NO restituía el stock: la unidad volvía en el canal de venta pero no
-- en el CRM ni en el otro canal, dejando un descuadre.
--
-- Pasó real con MQR004: se canceló la Venta TN #1055, Tienda Nube subió 454→455,
-- y el CRM y Mercado Libre se quedaron en 454.
--
-- Esta función SUMA las unidades canceladas al stock del CRM y deja el mismo
-- rastro en el ledger que el descuento, para que el hub pueda empujar el
-- movimiento (+N) a los demás canales igual que hace con una venta.
--
-- Idempotente a nivel de esquema: se puede pegar tal cual en el SQL Editor.
-- La idempotencia de negocio la garantiza quien llama: solo pasa las órdenes
-- cuyo renglón de `sales` EXISTÍA y se acaba de borrar (el DELETE … RETURNING
-- devuelve solo lo realmente retirado), así una segunda notificación de la misma
-- cancelación no encuentra nada que devolver.
-- ============================================================================

create or replace function public.devolver_stock_ventas(items jsonb, p_origen text)
returns table (
  id                    uuid,
  sku                   text,
  stock                 int,
  devuelto              int,
  bajo_pedido           boolean,
  tiendanube_product_id bigint,
  tiendanube_variant_id bigint,
  meli_item_id          text,
  meli_variation_id     bigint,
  meli_logistic_type    text
) language plpgsql security definer set search_path = public as $$
begin
  return query
  -- Suma cantidades por producto (una orden cancelada puede tener varias líneas).
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
       set stock = p.stock + e.cantidad
      from ent e
     where p.id = e.producto_id
    returning p.id, p.sku, p.stock as nuevo, e.cantidad as devuelto, p.bajo_pedido,
              p.tiendanube_product_id, p.tiendanube_variant_id,
              p.meli_item_id, p.meli_variation_id, p.meli_logistic_type
  ),
  -- CTE modificadora: siempre corre a término aunque no se referencie.
  logged as (
    insert into public.stock_log (producto_id, canal, origen, stock_anterior, stock_nuevo)
      select u.id, 'crm', p_origen, a.anterior, u.nuevo
        from upd u
        join antes a on a.id = u.id
    returning 1
  )
  select u.id, u.sku, u.nuevo, u.devuelto, u.bajo_pedido,
         u.tiendanube_product_id, u.tiendanube_variant_id,
         u.meli_item_id, u.meli_variation_id, u.meli_logistic_type
    from upd u;
end;
$$;

grant execute on function public.devolver_stock_ventas(jsonb, text) to service_role;

notify pgrst, 'reload schema';
