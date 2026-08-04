-- ============================================================================
-- 20260816000000_comision_canal.sql — Lo que cobra la plataforma por vender
-- ----------------------------------------------------------------------------
-- `sale_orders` guarda lo que pagó el comprador (total, envío, descuento), pero
-- no lo que se queda el canal. Entre esas dos cifras hay una quinta parte de la
-- venta: en TikTok la comisión ronda el 22% y en Mercado Libre el 17-19%, y
-- hasta ahora no aparecía en ninguna pantalla del CRM.
--
-- Mercado Libre la manda dentro de cada orden (`sale_fee` por línea), así que se
-- archiva al importar sin ninguna llamada extra. TikTok la entrega en cortes de
-- liquidación aparte, que se leen en vivo (ver lib/tiktok/finanzas.ts); esta
-- columna queda disponible para cuando también se archiven.
--
-- Va en `sale_orders` y no en `sales` por el mismo motivo que el total: es de la
-- ORDEN, y repetirla en cada renglón la duplicaría en cualquier suma.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.sale_orders
  add column if not exists comision numeric,
  add column if not exists costo_envio numeric;

comment on column public.sale_orders.comision is
  'Lo que cobró el canal por la venta, en positivo. Null = ese canal no lo reporta todavía.';

-- Ojo con no confundirla con `envio`, que es lo que pagó el COMPRADOR por el
-- flete. En Mercado Libre esas dos cifras casi nunca coinciden: el comprador
-- suele pagar 0 (envío gratis) mientras el vendedor sí paga su parte, así que
-- el costo real del canal solo se ve sumando ésta.
comment on column public.sale_orders.costo_envio is
  'Lo que le costó el envío al VENDEDOR, en positivo. Null = el canal no lo reporta.';

notify pgrst, 'reload schema';
