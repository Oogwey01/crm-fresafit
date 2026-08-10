-- ============================================================================
-- 20260930000000_maquila_costo_privado.sql
--   Lo que se le paga a Eduardo deja de estar a la vista de todo el equipo.
-- ----------------------------------------------------------------------------
-- Armando lo pidió confidencial: las tarifas y el costo por pieza son cosa de
-- dirección y administración. Hoy `maquila_costos` es SELECT es_interno() y el
-- costo viaja en una columna de `maquila_pedidos`, que cualquier coordinador
-- lee entera.
--
-- La RLS de Postgres es POR FILA, nunca por columna, y los grants por columna
-- son por rol de Postgres (`authenticated`), no por rol de la app. O sea: NO
-- hay forma de esconder maquila_pedidos.costo_maquila de un coordinador sin
-- sacar el dato de esa tabla. De ahí la tabla aparte — es la misma tesis que
-- ya sostiene el módulo: «el aislamiento financiero es por diseño de tabla, no
-- por vista» (cabecera de 20260924000000).
--
-- ORDEN IMPORTANTE. Esta migración va ANTES del deploy y deja la columna vieja
-- viva pero congelada: si algo sale mal, la marcha atrás es no correr
-- 20261001000000, que es la que la borra.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.maquila_pedido_costos (
  pedido_id    uuid primary key references public.maquila_pedidos(id) on delete cascade,
  -- Lo que Eduardo cobra por PIEZA, sin IVA. El corte multiplica por cantidad.
  costo        numeric(12,2) check (costo >= 0),
  tarifa_id    uuid references public.maquila_costos(id) on delete set null,
  congelado_en timestamptz not null default now()
);

comment on table public.maquila_pedido_costos is
  'El costo de maquila de cada pedido, fuera de maquila_pedidos para que la RLS lo pueda cerrar a administración. Es unitario: el corte lo multiplica por la cantidad del renglón.';

create index if not exists maquila_pedido_costos_tarifa_idx on public.maquila_pedido_costos (tarifa_id);

-- Se copia lo que ya había. `do nothing`: correr esto dos veces no pisa un
-- costo que ya se hubiera corregido en la tabla nueva.
insert into public.maquila_pedido_costos (pedido_id, costo)
  select id, costo_maquila from public.maquila_pedidos where costo_maquila is not null
on conflict (pedido_id) do nothing;

-- ---------------------------------------------------------------------------
-- Congelar la tarifa de un pedido SIN devolverle el importe a quien no lo
-- puede ver.
--
-- Es lo único que se muda a la base. La aritmética de fechas (ruta, corte,
-- promesa) se queda en lib/maquila/reglas.ts, que es donde vive y donde se
-- prueba con `node`: aquí solo entra lo que la confidencialidad obliga, que es
-- leer maquila_costos. Sin esta función, en cuanto la tabla de tarifas se
-- cierre, un coordinador corrigiendo un acabado dejaría el costo en null y
-- nadie se enteraría hasta el corte.
-- ---------------------------------------------------------------------------
create or replace function public.maquila_fijar_costo_pedido(pid uuid, p_fecha date default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  p        public.maquila_pedidos;
  v_fecha  date;
  v_tarifa public.maquila_costos;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede recalcular el costo de un pedido de maquila.';
  end if;

  select * into p from public.maquila_pedidos where id = pid;
  if not found then
    raise exception 'Ese pedido de maquila ya no existe.';
  end if;

  -- Sin pago no hay tarifa que congelar: el precio es el del día del pago.
  v_fecha := coalesce(p_fecha, (p.pagado_en at time zone 'America/Mexico_City')::date);
  if v_fecha is null then
    return;
  end if;

  select * into v_tarifa
    from public.maquila_costos
   where modelo = p.modelo and acabado = p.acabado and vigente_desde <= v_fecha
   order by vigente_desde desc
   limit 1;

  -- Sin tarifa vigente el costo queda null a propósito: la pantalla lo señala,
  -- que es mejor que inventar un cero y pagarlo.
  insert into public.maquila_pedido_costos (pedido_id, costo, tarifa_id, congelado_en)
    values (pid, v_tarifa.costo, v_tarifa.id, now())
  on conflict (pedido_id) do update
    set costo = excluded.costo, tarifa_id = excluded.tarifa_id, congelado_en = now();
end;
$$;
grant execute on function public.maquila_fijar_costo_pedido(uuid, date) to authenticated;

comment on function public.maquila_fijar_costo_pedido(uuid, date) is
  'Congela en maquila_pedido_costos la tarifa vigente para el modelo y acabado del pedido. No devuelve el importe: la llama quien puede corregir un pedido, que no siempre puede ver el dinero.';

-- ---------------------------------------------------------------------------
-- Permisos + RLS. Dirección y administración, y nadie más — ni el maquilero
-- (a él el costo se lo dice la factura del corte, no el tablero).
-- ---------------------------------------------------------------------------
grant all on public.maquila_pedido_costos to authenticated, service_role;

alter table public.maquila_pedido_costos enable row level security;

drop policy if exists "maquila costos pedido: ver (admin)" on public.maquila_pedido_costos;
create policy "maquila costos pedido: ver (admin)" on public.maquila_pedido_costos
  for select to authenticated using ((select public.es_administrativo()));

drop policy if exists "maquila costos pedido: gestionar (admin)" on public.maquila_pedido_costos;
create policy "maquila costos pedido: gestionar (admin)" on public.maquila_pedido_costos
  for all to authenticated
  using ((select public.es_administrativo()))
  with check ((select public.es_administrativo()));

-- Y la tabla de tarifas se cierra igual. OJO OPERATIVO: a partir de aquí, la
-- pestaña Configuración de un coordinador se queda sin la tabla de precios.
drop policy if exists "maquila costos: ver (interno)" on public.maquila_costos;
drop policy if exists "maquila costos: ver (admin)" on public.maquila_costos;
create policy "maquila costos: ver (admin)" on public.maquila_costos
  for select to authenticated using ((select public.es_administrativo()));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Sanity check: si algún costo se quedó sin copiar, NO sigas con el deploy.
-- ---------------------------------------------------------------------------
do $$
declare v_faltan int;
begin
  select count(*) into v_faltan
    from public.maquila_pedidos p
    left join public.maquila_pedido_costos c on c.pedido_id = p.id
   where p.costo_maquila is not null and c.pedido_id is null;

  if v_faltan > 0 then
    raise exception 'Quedaron % costos sin copiar a la tabla privada. No sigas.', v_faltan;
  end if;
  raise notice 'OK — costos copiados. Ya puedes desplegar el código y luego correr 20261001000000.';
end $$;

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select count(*) from public.maquila_pedido_costos;
--   select policyname from pg_policies where tablename in ('maquila_costos','maquila_pedido_costos');
--     -- las tres deben decir es_administrativo()
--   -- Cuadre columna vieja ↔ tabla nueva (mientras la columna siga viva):
--   select count(*) from public.maquila_pedidos p
--     join public.maquila_pedido_costos c on c.pedido_id = p.id
--    where p.costo_maquila is distinct from c.costo;   -- 0
-- ============================================================================
