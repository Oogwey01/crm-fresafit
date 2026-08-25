-- ============================================================================
-- 20261027000000_maquila_hebilla_gamuza.sql
--   Los cinturones de HEBILLA de gamuza también los fabrica Eduardo.
-- ----------------------------------------------------------------------------
-- 20261005000000 sembró la maquila de gamuza solo para POWERLIFT: su filtro
-- exigía `nombre ilike '%powerlift%'`, y dejó fuera a propósito la hebilla
-- (PRM030, PRM034). Esa decisión resultó equivocada — confirmado por Aaron el
-- 24-ago-2026: la hebilla de gamuza es suya igual que la de powerlift.
--
-- El síntoma: las órdenes de Tienda Nube #1385, #1386 y #1391 ("Cinturón
-- Hebilla Merlot / Marino / Negro Gamuza PRO") no aparecían en /maquila. Sin
-- ficha en `maquila_productos`, la ingesta descarta el renglón en silencio
-- (lib/maquila/ingesta.ts) y el tablero de Eduardo nunca se entera.
--
-- El criterio va por SKU, que es lo único estable entre canales
-- (lib/inventario/tipo-producto.ts):
--   · PRM… es cinturón de hebilla. Manda sobre el nombre: PRM034 se titula
--     "Gamuza Lord Edition … Powerlift" en Mercado Libre y aun así es hebilla.
--   · Sin SKU se cae al nombre, y ahí sí hay que exigir "hebilla" y excluir
--     "powerlift": así entran los diseños nuevos de Tienda Nube (Merlot,
--     Marino, Militar, Ensueño, Tizón, Chocolate, Rosa Flamingo, Rojo Pasión)
--     y las publicaciones de Mercado Libre ("Faja Cinturon Gym Hebilla Fresa
--     Fit Gamuza …"), sin volver a tocar las de powerlift que ya tienen ficha.
--   · Deja fuera LAS00M ("Cinturón de Hebilla tipo Lastre - Negro Gamuza"):
--     tiene SKU y no es PRM, así que no es de esta familia.
--
-- El acabado es `bordado_gamuza`, cuya tarifa de hebilla YA existe en
-- `maquila_costos` ($320 desde 2026-04-01): no hay que sembrar precio.
--
-- NO se toca `products.bajo_pedido`. Eso es otra cosa: enciende la ficha del
-- DISEÑADOR en /personalizados (lib/personalizados/desde-maquila.ts), y la
-- gamuza es un acabado de catálogo, no un cinturón con arte del cliente. Las
-- 118 fichas de gamuza powerlift que sembró 20261005000000 viven así desde
-- entonces: en /maquila sí, en /personalizados no. Esto las imita.
--
-- Alcance igual que la migración hermana: fichas ACTIVAS del catálogo, MÁS
-- cualquier producto dado de baja que ya tenga ventas, para que el histórico
-- no quede con huecos.
--
-- Idempotente: `on conflict do nothing` respeta cualquier ficha ya ajustada a
-- mano desde /maquila. Se puede pegar tal cual en el SQL Editor.
-- ============================================================================

set lock_timeout = '10s';

insert into public.maquila_productos (producto_id, modelo, acabado, combo, activo)
select p.id, 'hebilla', 'bordado_gamuza', 'ninguno', true
  from public.products p
 where p.nombre ilike '%gamuza%'
   and (
     -- El SKU manda: PRM… es hebilla aunque el título diga otra cosa.
     upper(coalesce(p.sku, '')) like 'PRM%'
     -- Sin SKU, el nombre es lo único que hay.
     or (
       p.sku is null
       and p.nombre ilike '%hebilla%'
       and p.nombre not ilike '%powerlift%'
     )
   )
   and (
     p.activo
     or exists (
       select 1 from public.sales s
        where s.producto_id = p.id
          and s.canal in ('tienda_nube', 'mercado_libre')
     )
   )
on conflict (producto_id) do nothing;

notify pgrst, 'reload schema';

-- ============================================================================
-- COMPROBACIÓN (pegar DESPUÉS)
-- ----------------------------------------------------------------------------
--   -- Las fichas nuevas, con su variante de Tienda Nube:
--   select p.sku, p.nombre, p.variante, p.activo, p.tiendanube_variant_id
--     from public.maquila_productos f
--     join public.products p on p.id = f.producto_id
--    where f.modelo = 'hebilla' and f.acabado = 'bordado_gamuza'
--    order by p.nombre, p.variante;
--
--   -- NO debe aparecer ningún SBD (esos son powerlift) ni LAS…:
--   select count(*) from public.maquila_productos f
--     join public.products p on p.id = f.producto_id
--    where f.modelo = 'hebilla'
--      and upper(coalesce(p.sku,'')) !~ '^PRM' and p.sku is not null;   -- 0
--
--   -- La tarifa que van a usar (debe existir, $320):
--   select * from public.maquila_costos
--    where modelo = 'hebilla' and acabado = 'bordado_gamuza';
--
-- DESPUÉS de aplicar: correr la sincronización NORMAL de Tienda Nube (la del
-- botón o la del cron) para que las órdenes recientes —#1385, #1386, #1391—
-- entren al tablero de Eduardo. La ingesta es idempotente; no duplica nada.
--
-- ⚠️ NO usar la reimportación COMPLETA (`?completo=1`, ventana de 90 días).
-- `aplicarRenglonesMaquila` no tiene corte por fecha —a diferencia de las
-- ventas, que sí lo tienen con `separarAltas`—, así que una pasada completa
-- daría de alta como «pendiente de producción» unos 36 cinturones de gamuza que
-- ya se vendieron Y SE ENTREGARON en los últimos 90 días, encima de los 77
-- pendientes reales que Eduardo tiene hoy. La ventana normal (7 días) solo
-- alcanza a lo que de verdad está por producirse.
-- ============================================================================
