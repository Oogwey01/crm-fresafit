-- ============================================================================
-- 20261001000000_maquila_costo_columna_fuera.sql
--   Tirar la columna vieja. CORRER DESPUÉS DEL DEPLOY.
-- ----------------------------------------------------------------------------
-- El costo ya vive en maquila_pedido_costos (20260930000000) y el código
-- desplegado ya no lo selecciona ni lo escribe. Esta migración cierra la
-- mudanza.
--
-- ORDEN, en serio:
--   1. correr 20260930000000  (copia el dato, cierra las tarifas)
--   2. desplegar el código    (deja de leer y escribir costo_maquila)
--   3. correr ESTA            (borra la columna)
--
-- Si se corre antes del paso 2, la ingesta y las acciones truenan al escribir
-- una columna que ya no existe. La marcha atrás del paso 1 es, precisamente,
-- no correr esta.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

-- Última red antes de tirar el dato: nada que no esté copiado.
do $$
declare v_faltan int;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'maquila_pedidos'
       and column_name = 'costo_maquila'
  ) then
    select count(*) into v_faltan
      from public.maquila_pedidos p
      left join public.maquila_pedido_costos c on c.pedido_id = p.id
     where p.costo_maquila is not null and c.pedido_id is null;

    if v_faltan > 0 then
      raise exception 'Hay % costos que solo existen en la columna vieja. Vuelve a correr 20260930000000 antes de borrarla.', v_faltan;
    end if;
  end if;
end $$;

alter table public.maquila_pedidos drop column if exists costo_maquila;

comment on table public.maquila_pedidos is
  'Pedidos de producción con Eduardo (Maquila México), una fila por renglón vendido. Independiente de sales: existe antes del pago y sobrevive cancelaciones. SIN dinero: ni el de venta ni el de maquila (ese vive en maquila_pedido_costos, cerrado a administración).';

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'maquila_pedidos'
--      and column_name = 'costo_maquila';           -- vacío
--   select count(*) from public.maquila_pedido_costos where costo is not null;
-- ============================================================================
