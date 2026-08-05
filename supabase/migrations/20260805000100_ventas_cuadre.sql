-- ============================================================================
-- 20260805000100_ventas_cuadre.sql — Cuadrar las ventas con los paneles oficiales
-- ----------------------------------------------------------------------------
-- Armando midió el mismo rango (27 jul – 2 ago) en el CRM y en los paneles de
-- los canales, y no cuadró: 90 687.59 vs 93 302.31 en Tienda Nube, 61 771.22 vs
-- 63 214 en Mercado Libre. La revisión del código encontró DOS causas distintas:
--
--   1) La FECHA del renglón se derivaba del instante crudo de cada API sin
--      convertirlo a hora de México (TikTok incluso pasaba por UTC), así que las
--      ventas de la noche caían en el día siguiente. Se arregla en el código
--      (lib/fecha.ts → diaMX), pero los renglones YA importados conservan la
--      fecha mala: por eso aquí va `sincronizar_renglones_venta`, que deja que
--      una re-sincronización corrija lo ya guardado.
--
--   2) `sales.monto` es solo precio × cantidad del producto. Los paneles suman
--      además envío, descuentos e impuestos. Por eso nace `sale_orders`: los
--      totales viven a nivel ORDEN. No se guardan como columnas de `sales`
--      porque `sales` tiene una fila por renglón y el total se duplicaría.
--
-- De paso se cierra el agujero que detectó Armando ("me deja modificar el precio
-- de una venta de Mercado Libre"): las ventas traídas por API pasan a ser de
-- solo lectura salvo para Dirección.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
--
-- Renombrado, no reescrito: este archivo era 20260805000000_ventas_cuadre.sql y
-- compartía versión con 20260805000000_tiktok_publicaciones.sql. El CLI de
-- Supabase usa ese prefijo como clave única en schema_migrations, así que se le
-- movió a ...000100 para deshacer la colisión. El contenido es el mismo y sigue
-- corriendo justo donde corría: después de la otra migración del mismo día, y
-- antes de los relevos de `sincronizar_renglones_venta` (20260808, 20260809,
-- 20260811, 20260815), que dependen de que ésta vaya primero.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Totales por ORDEN (lo que reportan los paneles de los canales)
-- ---------------------------------------------------------------------------
create table if not exists public.sale_orders (
  id                uuid primary key default gen_random_uuid(),
  canal             text not null
                    check (canal in ('tienda_nube','tiktok_shop','mercado_libre','punto_fisico','otro')),
  referencia_orden  text not null,          -- id de la orden en la plataforma
  numero            text,                   -- folio visible al cliente ("#1234")
  fecha             date not null,          -- día en hora de México (ver diaMX)
  total             numeric(12,2) not null default 0,  -- bruto: lo que cobra el panel
  subtotal          numeric(12,2) not null default 0,  -- solo productos
  envio             numeric(12,2) not null default 0,
  descuento         numeric(12,2) not null default 0,
  impuesto          numeric(12,2) not null default 0,
  moneda            text not null default 'MXN',
  estado            text,                   -- estado de la orden en el canal
  cliente_id        uuid references public.customers(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

create unique index if not exists sale_orders_ref_uidx
  on public.sale_orders(canal, referencia_orden);
create index if not exists sale_orders_fecha_idx on public.sale_orders(fecha);
create index if not exists sale_orders_canal_idx on public.sale_orders(canal);

drop trigger if exists sale_orders_touch on public.sale_orders;
create trigger sale_orders_touch
  before update on public.sale_orders
  for each row execute function public.touch_updated_at();

grant all on public.sale_orders to authenticated, service_role;
alter table public.sale_orders enable row level security;

-- Misma matriz que `sales`: el equipo interno las ve; nadie las edita a mano
-- (las escribe el importador con service_role, que salta RLS).
drop policy if exists "ordenes: ver (interno)" on public.sale_orders;
create policy "ordenes: ver (interno)" on public.sale_orders
  for select to authenticated using (public.es_interno());

-- ---------------------------------------------------------------------------
-- 2) Refrescar renglones ya importados desde una re-sincronización
-- ----------------------------------------------------------------------------
-- El upsert de los importadores usa `ignoreDuplicates: true` a propósito: así
-- `data` trae SOLO las filas nuevas y el hub de stock no descuenta dos veces la
-- misma venta en cada corrida. El precio de eso es que un renglón ya guardado
-- nunca se corrige, ni siquiera cuando su fecha estaba mal.
--
-- Esta función es el complemento: recibe los renglones recalculados y actualiza
-- los que YA existen, sin insertar ni tocar el stock. Solo pisa ventas de
-- `origen = 'api'`: las capturadas a mano son del equipo y no se tocan.
-- ---------------------------------------------------------------------------
create or replace function public.sincronizar_renglones_venta(
  p_canal text,
  p_filas jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with entrada as (
    select
      f->>'referencia_externa'          as ref,
      (f->>'fecha')::date               as fecha,
      (f->>'monto')::numeric            as monto,
      (f->>'cantidad')::int             as cantidad,
      f->>'estado'                      as estado,
      f->>'paqueteria'                  as paqueteria,
      f->>'num_guia'                    as num_guia
    from jsonb_array_elements(p_filas) as f
  ),
  actualizadas as (
    update public.sales s
       set fecha      = e.fecha,
           monto      = e.monto,
           cantidad   = e.cantidad,
           estado     = coalesce(e.estado, s.estado),
           -- La guía puede tardar en aparecer: no borrar la que ya se tenía.
           paqueteria = coalesce(e.paqueteria, s.paqueteria),
           num_guia   = coalesce(e.num_guia, s.num_guia)
      from entrada e
     where s.canal = p_canal
       and s.origen = 'api'
       and s.referencia_externa = e.ref
       and ( s.fecha      is distinct from e.fecha
          or s.monto      is distinct from e.monto
          or s.cantidad   is distinct from e.cantidad
          or s.estado     is distinct from coalesce(e.estado, s.estado)
          or s.paqueteria is distinct from coalesce(e.paqueteria, s.paqueteria)
          or s.num_guia   is distinct from coalesce(e.num_guia, s.num_guia) )
    returning 1
  )
  select count(*) into n from actualizadas;
  return n;
end;
$$;

revoke all on function public.sincronizar_renglones_venta(text, jsonb) from public, anon, authenticated;
grant execute on function public.sincronizar_renglones_venta(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Las ventas traídas por API son de solo lectura
-- ----------------------------------------------------------------------------
-- Antes, cualquier interno podía cambiar precio y cantidad de una venta de
-- Mercado Libre desde el diálogo de Métricas. Como la re-sync no pisaba filas
-- existentes, esa edición quedaba para siempre y el CRM dejaba de cuadrar con el
-- canal de forma permanente y silenciosa.
--
-- Dirección conserva la llave por si hay que corregir algo a mano; el resto del
-- equipo ya no puede. Las ventas manuales/CSV siguen igual que siempre.
-- ---------------------------------------------------------------------------
drop policy if exists "ventas: editar (interno)" on public.sales;
create policy "ventas: editar (interno)" on public.sales
  for update to authenticated
  using  (public.es_interno() and (origen <> 'api' or public.es_admin(auth.uid())))
  with check (public.es_interno() and (origen <> 'api' or public.es_admin(auth.uid())));

notify pgrst, 'reload schema';
