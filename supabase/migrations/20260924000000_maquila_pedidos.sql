-- ============================================================================
-- 20260924000000_maquila_pedidos.sql
--   El pedido de producción: lo que Eduardo ve, mueve y nada más.
-- ----------------------------------------------------------------------------
-- No es una columna más de `sales` a propósito, por tres razones que salen del
-- comportamiento real del importador de ventas:
--
--   1. Debe existir ANTES del pago. Las órdenes pending de Tienda Nube nunca
--      entran a `sales` (esVendible las filtra), pero la spec exige una
--      bandeja "Esperando pago" para verlas venir.
--   2. Debe SOBREVIVIR la cancelación. `sales` BORRA sus renglones cuando una
--      orden se cancela o reembolsa; un pedido de maquila cancelado se marca
--      —Eduardo pudo haberlo producido ya— y esa historia vale dinero.
--   3. Es una fila POR RENGLÓN, con la misma clave idempotente que `sales`
--      (canal, referencia_externa): una orden puede mezclar un prensado (+7
--      hábiles, sale directo) y un bordado (+10, va por corte), así que fecha
--      prometida, corte y semáforo son por pieza, no por orden.
--
-- Todo lo que el tablero pinta viaja aquí en SNAPSHOT (sku, diseño, modelo,
-- talla, dirección de envío): Eduardo no puede hacer JOIN a `products` ni a
-- `customers` porque su RLS no se lo da, y no le hace falta. Del cliente solo
-- viajan nombre, teléfono y dirección — lo que la guía de paquetería pide.
-- El ÚNICO dinero en esta tabla es `costo_maquila` (lo que Eduardo cobra por
-- la pieza): el aislamiento financiero es por diseño de tabla, no por vista.
--
-- La máquina de estados vive en un trigger y no en el código porque Eduardo
-- escribe por UPDATE normal (PostgREST): la base es el único lugar donde nadie
-- se la puede saltar. Para el maquilero: solo columnas operativas, solo hacia
-- adelante, y "enviado" exige guía. Para el equipo interno: sin recorte, que
-- corregir errores también es parte de operar.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.maquila_pedidos (
  id                 uuid primary key default gen_random_uuid(),

  -- Origen. Misma clave idempotente que sales: "order_id:variant_id" en TN.
  -- 'manual' cubre ventas por WhatsApp/DM; 'mercado_libre' queda listo para
  -- la Fase 2 sin re-migrar.
  canal              text not null check (canal in ('tienda_nube','mercado_libre','manual')),
  referencia_externa text,
  referencia_orden   text,
  numero_orden       text,
  sale_id            uuid references public.sales(id) on delete set null,
  producto_id        uuid references public.products(id) on delete set null,
  origen             text not null default 'api' check (origen in ('api','manual')),

  -- Producción (snapshot: el tablero nunca joinea products).
  sku                text,
  diseno             text,
  modelo             text not null check (modelo in ('powerlift','hebilla')),
  acabado            text not null check (acabado in ('prensado','sublimado','bordado','bordado_gamuza')),
  talla              text,
  color              text,
  cantidad           int not null default 1 check (cantidad > 0),
  requiere_palanca   boolean not null default false,
  palanca_color      text check (palanca_color in ('plateada','negra')),
  combo              text not null default 'ninguno'
                     check (combo in ('ninguno','munequeras','straps','ambos')),
  combo_diseno       text,

  -- Lo único de dinero: lo que Eduardo cobra por esta pieza (snapshot de
  -- maquila_costos a la fecha del pago, sin IVA).
  costo_maquila      numeric(12,2) check (costo_maquila >= 0),

  -- Fechas del compromiso. `pagado_en` es el instante real de aprobación del
  -- pago (paid_at de TN): de ahí —y no de la fecha de compra— sale todo.
  pagado_en          timestamptz,
  ruta               text check (ruta in ('directa','corte')),
  corte_fecha        date,
  fecha_prometida    date,
  -- Estampadas por el trigger al transicionar; el corte quincenal de pago
  -- (Fase 2) liquida con `enviado_en` sin recalcular nada.
  terminado_en       timestamptz,
  enviado_en         timestamptz,
  entregado_en       timestamptz,

  estado             text not null default 'esperando_pago'
                     check (estado in ('esperando_pago','recibido','pendiente_produccion',
                                       'en_produccion','terminado','enviado','entregado',
                                       'cancelado','devuelto')),
  -- Sub-estados de la ruta por lote: es la trazabilidad del TERCERO
  -- (bordador/impresor), el riesgo #1 del proyecto según la spec.
  subestado          text check (subestado in ('entregado_a_tercero','recogido_de_tercero',
                                               'en_confeccion','listo_para_envio')),
  constraint maquila_subestado_coherente check (
    subestado is null
    or (estado = 'en_produccion' and acabado in ('sublimado','bordado','bordado_gamuza'))
  ),

  -- Envío. Mismos nombres que sales para no inventar un segundo vocabulario.
  paqueteria         text,
  num_guia           text,
  url_rastreo        text,

  -- Del cliente, SOLO lo que la guía pide. Forma de normalizarDireccion
  -- (lib/canales/direccion.ts) en el jsonb.
  envio_nombre       text,
  envio_telefono     text,
  envio_direccion    jsonb,

  notas              text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.maquila_pedidos is
  'Pedidos de producción con Eduardo (Maquila México), una fila por renglón vendido. Independiente de sales: existe antes del pago y sobrevive cancelaciones. Sin dinero de venta a propósito.';
comment on column public.maquila_pedidos.palanca_color is
  'Crítico: es donde más se equivoca el armado. Null = sin definir; la UI y la ficha imprimible lo gritan.';
comment on column public.maquila_pedidos.pagado_en is
  'Instante de aprobación del pago (paid_at del canal). La fecha prometida se calcula desde aquí, nunca desde la fecha de compra.';

-- La clave idempotente de la ingesta (upsert de webhook + cron + botón, igual
-- que sales_ref_externa_uidx). Parcial: los pedidos manuales no llevan
-- referencia.
create unique index if not exists maquila_ped_ref_externa_uidx
  on public.maquila_pedidos (canal, referencia_externa)
  where referencia_externa is not null;

create index if not exists maquila_ped_estado_idx    on public.maquila_pedidos (estado);
create index if not exists maquila_ped_prometida_idx on public.maquila_pedidos (fecha_prometida);
create index if not exists maquila_ped_corte_idx     on public.maquila_pedidos (corte_fecha);
-- Para propagar la guía a los renglones hermanos de la misma orden.
create index if not exists maquila_ped_orden_idx     on public.maquila_pedidos (canal, referencia_orden);
-- Higiene de FKs (ver 20260825000000_indices.sql).
create index if not exists maquila_ped_sale_idx      on public.maquila_pedidos (sale_id);
create index if not exists maquila_ped_producto_idx  on public.maquila_pedidos (producto_id);
create index if not exists maquila_ped_created_by_idx on public.maquila_pedidos (created_by);

drop trigger if exists maquila_pedidos_touch_trg on public.maquila_pedidos;
create trigger maquila_pedidos_touch_trg
  before update on public.maquila_pedidos
  for each row execute function public.maquila_touch();

-- ---------------------------------------------------------------------------
-- La máquina de estados. Rangos para poder decir "solo hacia adelante" sin
-- enumerar todas las parejas; cancelado/devuelto quedan fuera de la cadena
-- (solo el equipo interno llega ahí).
-- ---------------------------------------------------------------------------
create or replace function public.maquila_rango_estado(e text)
returns int language sql immutable as $$
  select case e
    when 'esperando_pago'        then 0
    when 'recibido'              then 1
    when 'pendiente_produccion'  then 2
    when 'en_produccion'         then 3
    when 'terminado'             then 4
    when 'enviado'               then 5
    when 'entregado'             then 6
    else -1 end;  -- cancelado / devuelto: fuera de la cadena
$$;

create or replace function public.maquila_rango_subestado(s text)
returns int language sql immutable as $$
  select case s
    when 'entregado_a_tercero'  then 1
    when 'recogido_de_tercero'  then 2
    when 'en_confeccion'        then 3
    when 'listo_para_envio'     then 4
    else 0 end;   -- null: aún sin subestado
$$;

create or replace function public.validar_cambio_maquila()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Columnas que el maquilero SÍ puede tocar. Todo lo demás (incluidas las
  -- columnas que se agreguen en el futuro) queda congelado para él.
  permitidas constant text[] := array[
    'estado','subestado','paqueteria','num_guia','url_rastreo','notas',
    'updated_at','terminado_en','enviado_en','entregado_en'
  ];
begin
  -- Al salir de "en producción" el subestado ya no aplica: se limpia solo para
  -- que el CHECK compuesto no muerda una transición legítima.
  if new.estado is distinct from old.estado and new.estado <> 'en_produccion' then
    new.subestado := null;
  end if;

  if public.es_maquilero() then
    -- 1) Solo columnas operativas.
    if to_jsonb(new) - permitidas is distinct from to_jsonb(old) - permitidas then
      raise exception 'Solo puedes cambiar estado, subestado, guía y notas del pedido.';
    end if;

    -- 2) Estados: solo hacia adelante en la cadena de producción.
    if new.estado is distinct from old.estado then
      if public.maquila_rango_estado(new.estado) < 0 then
        raise exception 'Cancelar o marcar devolución le toca al equipo de Fresa Fit.';
      end if;
      if public.maquila_rango_estado(old.estado) < 0 then
        raise exception 'Este pedido está % y ya no se mueve.', old.estado;
      end if;
      if public.maquila_rango_estado(new.estado) <= public.maquila_rango_estado(old.estado) then
        raise exception 'El pedido no puede regresar de «%» a «%»; si fue un error, avisa al equipo.',
          old.estado, new.estado;
      end if;
      if new.estado = 'enviado' and nullif(btrim(coalesce(new.num_guia, '')), '') is null then
        raise exception 'Captura la guía de envío antes de marcar el pedido como enviado.';
      end if;
    end if;

    -- 3) Subestados: solo hacia adelante (el CHECK ya limita a en_produccion
    --    con acabado por lote).
    if new.subestado is distinct from old.subestado
       and new.estado = 'en_produccion'
       and public.maquila_rango_subestado(new.subestado) <= public.maquila_rango_subestado(old.subestado)
    then
      raise exception 'El subestado no puede regresar de «%» a «%».', old.subestado, new.subestado;
    end if;
  end if;

  -- Sellos de tiempo (para cualquier actor): el corte quincenal y la
  -- analítica de cumplimiento se leen de aquí sin recalcular.
  if new.estado is distinct from old.estado then
    if new.estado = 'terminado' and new.terminado_en is null then
      new.terminado_en := now();
    elsif new.estado = 'enviado' and new.enviado_en is null then
      new.enviado_en := now();
    elsif new.estado = 'entregado' and new.entregado_en is null then
      new.entregado_en := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists maquila_pedidos_validar_trg on public.maquila_pedidos;
create trigger maquila_pedidos_validar_trg
  before update on public.maquila_pedidos
  for each row execute function public.validar_cambio_maquila();

-- ---------------------------------------------------------------------------
-- Permisos + RLS.
--   Interno: ve y gestiona todo (crear captura manual, corregir, cancelar).
--   Maquilero: ve todo MENOS lo no pagado (para él no existe hasta que el
--   pago se aprueba) y actualiza — el trigger de arriba decide qué exactamente.
--   Borrar: nadie. Cancelado es un estado, no un DELETE.
-- ---------------------------------------------------------------------------
grant all on public.maquila_pedidos to authenticated, service_role;

alter table public.maquila_pedidos enable row level security;

drop policy if exists "maquila pedidos: ver (interno)" on public.maquila_pedidos;
create policy "maquila pedidos: ver (interno)" on public.maquila_pedidos
  for select to authenticated using ((select public.es_interno()));

drop policy if exists "maquila pedidos: ver (maquilero)" on public.maquila_pedidos;
create policy "maquila pedidos: ver (maquilero)" on public.maquila_pedidos
  for select to authenticated
  using ((select public.es_maquilero()) and estado <> 'esperando_pago');

drop policy if exists "maquila pedidos: crear (interno)" on public.maquila_pedidos;
create policy "maquila pedidos: crear (interno)" on public.maquila_pedidos
  for insert to authenticated with check ((select public.es_interno()));

drop policy if exists "maquila pedidos: actualizar (interno)" on public.maquila_pedidos;
create policy "maquila pedidos: actualizar (interno)" on public.maquila_pedidos
  for update to authenticated
  using ((select public.es_interno()))
  with check ((select public.es_interno()));

drop policy if exists "maquila pedidos: actualizar (maquilero)" on public.maquila_pedidos;
create policy "maquila pedidos: actualizar (maquilero)" on public.maquila_pedidos
  for update to authenticated
  using ((select public.es_maquilero()) and estado <> 'esperando_pago')
  with check ((select public.es_maquilero()));

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select count(*) from public.maquila_pedidos;   -- 0 hasta la primera ingesta
--   select policyname from pg_policies where tablename = 'maquila_pedidos';
--     -- 5 policies: ver ×2, crear, actualizar ×2
--   select tgname from pg_trigger
--    where tgrelid = 'public.maquila_pedidos'::regclass and not tgisinternal;
--     -- maquila_pedidos_touch_trg y maquila_pedidos_validar_trg
-- ============================================================================
