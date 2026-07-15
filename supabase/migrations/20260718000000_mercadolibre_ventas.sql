-- ============================================================================
-- Fresafit CRM — Mercado Libre: identificar clientes por buyer_id
-- ----------------------------------------------------------------------------
-- A diferencia de Tienda Nube (que identifica al comprador por correo), Mercado
-- Libre RESTRINGE el PII del comprador en sus órdenes: el correo suele venir
-- anonimizado o ausente. El id de usuario de ML (buyer.id) es la llave natural
-- para no duplicar clientes. Espejo de `tiendanube_customer_id`.
-- El índice único NO es parcial a propósito: PostgREST solo infiere el
-- ON CONFLICT de un upsert con índices completos, y los NULL no chocan entre sí
-- (clientes de otros canales sin buyer_id conviven sin problema).
-- La importación de ventas NO depende de esta columna para funcionar: si falta,
-- la sync de clientes se salta (no fatal) y las ventas igual se registran.
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

alter table public.customers add column if not exists mercadolibre_buyer_id bigint;

create unique index if not exists customers_meli_buyer_uidx
  on public.customers(mercadolibre_buyer_id);

notify pgrst, 'reload schema';
