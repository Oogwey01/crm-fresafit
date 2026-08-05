-- ============================================================================
-- 20260823000000_proveedores_solo_direccion.sql
-- ----------------------------------------------------------------------------
-- Proveedores salió de Inventario a su propio módulo, y ese módulo es solo de
-- DIRECCIÓN. Esta migración baja el candado a la base: hasta ahora estas tablas
-- eran `es_interno()` y el corte por rol vivía solo en la pantalla, así que
-- quien supiera pedirlo a la API seguía viendo a cómo se compra cada cinturón.
--
-- Lo que se cierra es EL PRECIO, no el proveedor:
--
--   * supplier_orders / _items / _payments / _incidents → solo dirección.
--     Ahí están los costos unitarios, los pagos y sus comprobantes.
--
--   * suppliers → se puede seguir LEYENDO desde el equipo interno; escribir
--     queda en dirección. No es un descuido: el catálogo de inventario muestra
--     el nombre del proveedor de cada ficha, y el cálculo de «Qué pedir» usa sus
--     `dias_entrega` para saber con cuánta anticipación pedir. Cerrarlo dejaba a
--     coordinación reordenando con el plazo por defecto sin enterarse.
--
--   * products.proveedor_id no se toca: qué proveedor surte cada ficha es dato
--     de inventario.
--
-- Y como «Qué pedir» necesita las unidades que ya vienen en camino —que viven
-- en `supplier_order_items`, ahora cerrada—, se expone justo eso y nada más con
-- una función security definer: producto y cantidad, sin costo ni proveedor.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Pedidos, renglones, pagos e incidencias: solo dirección.
--    Se retiran TODAS las políticas de cada tabla antes de poner las nuevas: si
--    quedara una vieja con `es_interno()`, bastaría ella para dar acceso (las
--    políticas de un mismo comando se SUMAN, no se restan).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'supplier_orders',
    'supplier_order_items',
    'supplier_order_payments',
    'supplier_order_incidents'
  ]
  loop
    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;

    execute format(
      'create policy %I on public.%I
         for select to authenticated using (public.es_admin(auth.uid()))',
      t || ': ver (direccion)', t);
    execute format(
      'create policy %I on public.%I
         for all to authenticated
         using (public.es_admin(auth.uid()))
         with check (public.es_admin(auth.uid()))',
      t || ': gestionar (direccion)', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Proveedores: leer todo el equipo interno, escribir solo dirección.
-- ---------------------------------------------------------------------------
do $$
declare
  p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'suppliers'
  loop
    execute format('drop policy if exists %I on public.suppliers', p.policyname);
  end loop;
end
$$;

create policy "proveedores: ver (interno)" on public.suppliers
  for select to authenticated using (public.es_interno());
create policy "proveedores: gestionar (direccion)" on public.suppliers
  for all to authenticated
  using (public.es_admin(auth.uid()))
  with check (public.es_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. Lo único que Inventario necesita de los pedidos: cuántas unidades de cada
--    producto ya vienen en camino. Sin costo, sin proveedor, sin folio.
-- ---------------------------------------------------------------------------
create or replace function public.unidades_en_camino()
returns table (producto_id uuid, unidades bigint)
language sql
stable
security definer
set search_path = public
as $$
  select i.producto_id, sum(i.cantidad)::bigint
    from public.supplier_order_items i
    join public.supplier_orders o on o.id = i.pedido_id
   where i.producto_id is not null
     and o.estado in ('pedido','en_transito','en_aduana')
     and public.es_interno()          -- el candado, dentro de la función
   group by i.producto_id;
$$;

grant execute on function public.unidades_en_camino() to authenticated;

notify pgrst, 'reload schema';
