-- ============================================================================
-- 20260803000000_og_descontinuados.sql — Marcar las líneas OG como descontinuadas
-- ----------------------------------------------------------------------------
-- Los modelos OG (straps y muñequeras viejas, ≈$598) ya no se reponen: quedan
-- fuera de «Qué pedir» y de los avisos de stock, pero conservan su histórico y
-- su stock para poder vender lo que queda.
--
-- Qué cuenta como OG (misma regla que lib/inventario/tipo-producto.ts):
--
--   * tipo = straps_viejos | munequeras_viejos
--     Es el camino principal: la migración 20260723000001 ya clasificó todo el
--     catálogo con esta misma lógica, así que aquí debería caer casi todo.
--
--   * red de seguridad, para lo dado de alta o reclasificado a mano después:
--     sufijo OG en el SKU (STR010OG) o la palabra SUELTA «og» en el nombre
--     ("Muñequeras Minato OG"), Y SOLO si el renglón es de la línea de straps o
--     muñequeras. Fuera de esas dos líneas «OG» no significa modelo viejo, y sin
--     ese cerco un producto cualquiera que llevara «og» en el nombre se
--     descontinuaría por accidente.
--
-- Idempotente: el guardia `descontinuado = false` hace que una segunda corrida
-- afecte 0 renglones. El RETURNING de abajo imprime exactamente lo que marcó,
-- para revisarlo en el SQL Editor.
--
-- ANTES DE CORRERLO, para ver qué va a tocar sin cambiar nada, corre el mismo
-- WHERE como SELECT:
--
--   select sku, nombre, tipo, stock, activo
--     from public.products
--    where descontinuado = false
--      and ( tipo in ('straps_viejos','munequeras_viejos')
--         or ( ( upper(coalesce(sku,'')) like '%OG' or nombre ~* '\mog\M' )
--              and ( upper(coalesce(sku,'')) like 'STR%'
--                 or upper(coalesce(sku,'')) like 'MQR%'
--                 or nombre ~* 'strap|muñequ|munequ|wraps'
--                 or tipo in ('straps_pro','munequeras_pro') ) ) )
--    order by tipo, sku;
--
-- Si algo de esa lista NO es OG, destildar «Descontinuado» en su ficha después
-- de correr esto (el CRM lo deja editar producto por producto).
-- ============================================================================

update public.products
   set descontinuado = true
 where descontinuado = false
   and (
     -- Camino principal: la línea ya está clasificada como modelo viejo.
     tipo in ('straps_viejos', 'munequeras_viejos')
     -- Red de seguridad, acotada a straps/muñequeras.
     or (
       ( upper(coalesce(sku, '')) like '%OG' or nombre ~* '\mog\M' )
       and (
            upper(coalesce(sku, '')) like 'STR%'
         or upper(coalesce(sku, '')) like 'MQR%'
         or nombre ~* 'strap|muñequ|munequ|wraps'
         or tipo in ('straps_pro', 'munequeras_pro')
       )
     )
   )
returning sku, nombre, tipo, stock, activo;

notify pgrst, 'reload schema';
