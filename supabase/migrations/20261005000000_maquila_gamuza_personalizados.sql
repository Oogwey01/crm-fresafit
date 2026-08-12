-- ============================================================================
-- 20261005000000_maquila_gamuza_personalizados.sql
--   Encender la maquila para lo que Eduardo ya fabrica: los cinturones de
--   gamuza PRO y todos los personalizados.
-- ----------------------------------------------------------------------------
-- `maquila_productos` estaba vacía, y la ingesta solo crea pedidos para
-- renglones cuyo producto tiene ficha activa (lib/maquila/ingesta.ts): sin
-- fichas, el tablero de Eduardo arranca en blanco por más que se venda. Esto
-- siembra las dos familias que sí son suyas.
--
-- El criterio de gamuza va por SKU y no por la palabra "PRO" del nombre:
--   · SBD… es cinturón de powerlift (lib/inventario/tipo-producto.ts), y el
--     modelo PRO se distingue del viejo por la AUSENCIA del sufijo OG, no por
--     la palabra. Los SBD039/040/042/043 que no la traen son fichas viejas del
--     mismo SKU y entran igual.
--   · Deja fuera PRM030 ("Cinturón de Hebilla Gamuza Rosa PRO": es hebilla) y
--     PRM034 ("Gamuza Lord Edition … Powerlift": SKU premium, aunque el título
--     de Mercado Libre diga powerlift).
--   · Deja dentro las fichas SIN sku: los diseños nuevos de Tienda Nube
--     (Merlot, Militar, Marino, Ensueño, Tizón, Rojo Pasión, Chocolate, Rosa,
--     Flamingo) y las publicaciones de Mercado Libre ("Faja Cinturon Gym
--     Powerlift Fresafit Gamuza …").
--
-- En los personalizados el acabado que se siembra es solo el DEFAULT: el
-- cliente elige sublimado o bordado con gamuza al comprar, y se corrige por
-- pedido con editarPedidoMaquila. El prensado ahí no existe (dixit Armando).
--
-- Alcance: fichas ACTIVAS del catálogo (para que lo nuevo entre solo) MÁS
-- cualquier producto que ya tenga ventas en Tienda Nube o Mercado Libre aunque
-- esté dado de baja — si no, el respaldo del histórico (scripts/respaldo-
-- maquila.mjs) dejaría huecos justo en los diseños que se descontinuaron.
--
-- Idempotente: `on conflict do nothing` respeta la ficha que alguien ya haya
-- ajustado a mano desde /maquila. Se puede pegar tal cual en el SQL Editor.
-- ============================================================================

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Cinturones de powerlift de gamuza → bordado + gamuza (tarifa $420).
-- ---------------------------------------------------------------------------
insert into public.maquila_productos (producto_id, modelo, acabado, combo, activo)
select p.id, 'powerlift', 'bordado_gamuza', 'ninguno', true
  from public.products p
 where p.nombre ilike '%powerlift%'
   and p.nombre ilike '%gamuza%'
   and (p.sku is null or upper(p.sku) like 'SBD%')
   and (
     p.activo
     or exists (
       select 1 from public.sales s
        where s.producto_id = p.id
          and s.canal in ('tienda_nube','mercado_libre')
     )
   )
on conflict (producto_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Personalizados. El modelo lo dice el prefijo del SKU; el acabado es el
--    default que corrige cada pedido.
-- ---------------------------------------------------------------------------
insert into public.maquila_productos (producto_id, modelo, acabado, combo, activo)
select p.id,
       case when upper(coalesce(p.sku,'')) like 'SBDPER%' then 'powerlift' else 'hebilla' end,
       'sublimado',
       'ninguno',
       true
  from public.products p
 where (
     upper(coalesce(p.sku,'')) like 'SBDPER%'
     or upper(coalesce(p.sku,'')) like 'PRMPER%'
     or upper(coalesce(p.sku,'')) = 'AS-1'   -- publicación de ML: hebilla personalizado
   )
   and (
     p.activo
     or exists (
       select 1 from public.sales s
        where s.producto_id = p.id
          and s.canal in ('tienda_nube','mercado_libre')
     )
   )
on conflict (producto_id) do nothing;

notify pgrst, 'reload schema';

-- ============================================================================
-- COMPROBACIÓN PREVIA (pegar ANTES, para revisar a quién alcanza)
-- ----------------------------------------------------------------------------
--   select f.modelo, f.acabado, p.sku, p.nombre, p.variante, p.activo,
--          p.tiendanube_variant_id, p.meli_item_id
--     from public.maquila_productos f
--     join public.products p on p.id = f.producto_id
--    order by f.modelo, f.acabado, p.sku nulls last, p.nombre;
--
--   -- NO debe aparecer ningún PRM030 ni PRM034:
--   select count(*) from public.maquila_productos f
--     join public.products p on p.id = f.producto_id
--    where upper(coalesce(p.sku,'')) like 'PRM03%';          -- 0
--
--   -- Los ocho personalizados de Tienda Nube, con su variante:
--   select p.sku, p.variante, f.modelo from public.maquila_productos f
--     join public.products p on p.id = f.producto_id
--    where upper(coalesce(p.sku,'')) ~ '^(SBD|PRM)PER'
--    order by p.sku;
-- ============================================================================
