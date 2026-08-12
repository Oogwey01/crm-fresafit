-- ============================================================================
-- 20261006000000_personalizados_venta.sql — El personalizado apunta a su venta
-- ----------------------------------------------------------------------------
-- QUÉ RESUELVE. El «Nº de venta» de un personalizado se teclea a mano y se
-- copia del panel del canal. Se equivoca un dígito y la ficha queda colgando de
-- un número que no existe; y para saber qué se vendió hay que buscar el folio a
-- mano en la tienda. Con esta columna, elegir la venta de una lista deja la liga
-- guardada de verdad.
--
-- POR QUÉ APUNTA A `sale_orders` Y NO A `sales`. `sales` guarda UN RENGLÓN POR
-- PRODUCTO, no una orden, y su `referencia_externa` es "<order_id>:<variant_id>"
-- (lib/tiendanube/ventas.ts). El número que la gente copia —"4728"— es el folio
-- visible al cliente, que vive en `sale_orders.numero` y es el mismo que guarda
-- `maquila_pedidos.numero_orden`. Buscar "4728" en `sales` no encuentra nada.
--
-- QUÉ **NO** CAMBIA. `personalizados.no_venta` sigue siendo TEXTO LIBRE y sigue
-- recibiendo el folio visible. De eso dependen dos cosas que se romperían en
-- silencio si se migrara a un FK a secas:
--   · el cruce con maquila —app/(app)/maquila/acciones/disenos.ts hace un ilike
--     de `no_venta` contra `maquila_pedidos.numero_orden`—, y
--   · la deduplicación del importador de la hoja (no_venta + cliente).
-- Además hay ventas que nunca entraron al CRM (`sale_orders` solo existe desde
-- 20260805000100) y personalizados vendidos por fuera. La liga es un extra para
-- lo que SÍ está, no un requisito.
--
-- Anulable y ON DELETE SET NULL: la ficha del personalizado vale por sí sola —
-- lleva cliente, diseño y producción—, así que una orden purgada no puede
-- llevársela por delante.
--
-- Sin GRANT ni RLS nuevos: `personalizados` no tiene grants por columna (eso es
-- solo `sales` y `products`, ver 20260902000000), así que la columna nace
-- legible; y `sale_orders` ya es SELECT para el equipo interno.
--
-- Idempotente: se puede volver a pegar tal cual en el SQL Editor.
-- ============================================================================

set lock_timeout = '10s';

alter table public.personalizados
  add column if not exists sale_order_id uuid
    references public.sale_orders(id) on delete set null;

comment on column public.personalizados.sale_order_id is
  'Orden del CRM de la que salió este personalizado. Complementa a no_venta (texto libre), que sigue siendo la llave de cruce con maquila.';

-- Para responder «¿qué personalizados salieron de esta orden?» sin recorrer la
-- tabla entera. Parcial: la enorme mayoría de las filas viejas están en NULL y
-- no hay por qué indexarlas.
create index if not exists personalizados_sale_order_idx
  on public.personalizados (sale_order_id)
  where sale_order_id is not null;
