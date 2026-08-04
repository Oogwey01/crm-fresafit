-- ============================================================================
-- 20260807000000_direccion_envio.sql — Guardar la dirección de envío
-- ----------------------------------------------------------------------------
-- Armando: "cada plataforma te da diferente información del cliente… Tienda Nube
-- te da hasta su WhatsApp, su correo, hasta dónde viven… eso es importante, no
-- perder información de los clientes".
--
-- El CRM no guardaba NINGUNA dirección, aunque las tres APIs la mandan: para
-- empacar un pedido había que entrar al panel del canal. Se guarda en dos sitios
-- distintos a propósito:
--
--   * `sales.envio_direccion` (jsonb) — la dirección DE ESE PEDIDO. Es la que
--     sirve para empacar y la que no debe cambiar si el cliente se muda después.
--   * `customers.ciudad/estado/cp` — de dónde es el cliente, para poder mirar
--     de qué parte del país vende más el negocio.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Dirección del pedido
-- ----------------------------------------------------------------------------
-- jsonb y no columnas sueltas porque cada canal manda un juego distinto de
-- campos (Tienda Nube da calle/número/colonia; Mercado Libre da su propio
-- desglose; TikTok agrega el detalle en pocas líneas). Se normaliza lo que se
-- puede en el importador y lo demás se conserva tal cual llegó.
-- ---------------------------------------------------------------------------
alter table public.sales add column if not exists envio_direccion jsonb;

comment on column public.sales.envio_direccion is
  'Dirección de envío tal como la mandó el canal: {nombre, telefono, calle, numero, colonia, ciudad, estado, cp, pais, referencias}. Del PEDIDO, no del cliente.';

-- ---------------------------------------------------------------------------
-- 2) De dónde es el cliente
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists ciudad text;
alter table public.customers add column if not exists estado text;
alter table public.customers add column if not exists cp     text;

-- Para agrupar ventas por zona sin escanear la tabla entera.
create index if not exists customers_estado_idx on public.customers (estado)
  where estado is not null;

notify pgrst, 'reload schema';
