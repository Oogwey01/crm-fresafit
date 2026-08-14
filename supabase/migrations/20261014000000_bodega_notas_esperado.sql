-- ============================================================================
-- Bodega: lo que pidió Armando en la junta del 13/08/2026.
--
--   * envio_full_cajas.nota — para distinguir cajas ("esta lleva muñequeras")
--     y dejar rastro de incidencias ("la caja 1 no entró: venía rota").
--   * recepcion_items.esperado — cuántas unidades TENÍAN que llegar según el
--     pedido al proveedor ("pedí 50 cinturones, llegaron 48"). Va aparte de
--     `unidades_no_procesadas` (lo que de verdad llegó); null = no se sabe lo
--     esperado (recepción sin pedido ligado) y la UI no pinta diferencia.
--   * recepcion_items.nota — la nota del renglón ("2 llegaron maltratados").
--
-- Sin cambios de RLS: las tres tablas ya tienen grant de tabla completa para
-- el equipo interno (20260821000000_bodega.sql) y las columnas nuevas lo
-- heredan. Idempotente: correrla dos veces no truena.
-- ============================================================================

alter table public.envio_full_cajas
  add column if not exists nota text;

alter table public.recepcion_items
  add column if not exists esperado int
    check (esperado is null or esperado >= 0);

alter table public.recepcion_items
  add column if not exists nota text;
