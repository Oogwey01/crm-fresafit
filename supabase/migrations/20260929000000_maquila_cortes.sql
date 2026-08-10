-- ============================================================================
-- 20260929000000_maquila_cortes.sql
--   Cuánto se le debe a Eduardo esta quincena.
-- ----------------------------------------------------------------------------
-- «Cada quincena le voy a estar pagando». El corte suma lo que SALIÓ en el
-- periodo, le agrega el 16% aparte, resta los anticipos que tenga a favor y
-- queda listo para pagarse y facturarse.
--
-- Decisiones que conviene no re-discutir:
--
--   * SE PAGA LO ENVIADO, no lo entregado. `enviado_en` lo sella el trigger
--     cuando la pieza sale con su guía; `entregado_en` depende de que alguien
--     marque la entrega, y eso hoy casi nadie lo hace. Colgar el pago de un
--     campo que se olvida sería colgarlo de nada.
--
--   * EL COSTO ES UNITARIO. maquila_pedido_costos.costo es la tarifa por
--     pieza; el renglón del corte multiplica por `cantidad`. Un renglón de dos
--     cinturones se paga doble.
--
--   * UN PEDIDO NO SE PAGA DOS VECES. Índice único parcial sobre pedido_id
--     entre los renglones vivos. Cancelar un corte ANULA, no borra: los
--     pedidos vuelven a estar disponibles y los anticipos recuperan su saldo.
--
--   * LA TASA DE IVA SE CONGELA en el corte. Si algún día cambia la ley, los
--     cortes viejos no se mueven solos.
--
--   * CALCULAR ES RE-EJECUTABLE. Si llega tarde un pedido del periodo, se
--     vuelve a llamar y solo entran los que faltaban.
--
-- Todo esto es dinero: RLS de administración.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.maquila_cortes (
  id                  uuid primary key default gen_random_uuid(),
  periodo_desde       date not null,
  periodo_hasta       date not null,
  estado              text not null default 'borrador'
                      check (estado in ('borrador','cerrado','pagado','cancelado')),

  piezas              int           not null default 0,
  subtotal            numeric(14,2) not null default 0,   -- sin IVA
  iva_tasa            numeric(5,4)  not null default 0.16,
  iva                 numeric(14,2) not null default 0,
  anticipos_aplicados numeric(14,2) not null default 0,
  total               numeric(14,2) not null default 0,   -- subtotal + iva − anticipos

  cerrado_en    timestamptz,
  cerrado_por   uuid references public.profiles(id) on delete set null,
  pagado_en     timestamptz,
  pagado_por    uuid references public.profiles(id) on delete set null,
  metodo_pago   text,

  factura_folio text,
  factura_uuid  text,
  factura_path  text,     -- bucket `facturas` (el de finanzas)
  -- Queda listo para ligar el corte a su renglón de gastos. Hoy no se escribe:
  -- `expenses` es de dirección y quien captura los cortes es administración.
  expense_id    uuid references public.expenses(id) on delete set null,

  notas      text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint maquila_cortes_periodo_ordenado check (periodo_hasta >= periodo_desde)
);

comment on table public.maquila_cortes is
  'Liquidación quincenal a Eduardo: lo enviado en el periodo + IVA − anticipos. Un periodo no se corta dos veces (salvo cancelados).';

-- Espejo de agencia_ingresos_corte_unico: un periodo, un corte vivo.
create unique index if not exists maquila_cortes_periodo_uidx
  on public.maquila_cortes (periodo_desde, periodo_hasta)
  where estado <> 'cancelado';

create index if not exists maquila_cortes_estado_idx     on public.maquila_cortes (estado, periodo_desde desc);
create index if not exists maquila_cortes_expense_idx    on public.maquila_cortes (expense_id);
create index if not exists maquila_cortes_created_by_idx on public.maquila_cortes (created_by);

drop trigger if exists maquila_cortes_touch_trg on public.maquila_cortes;
create trigger maquila_cortes_touch_trg
  before update on public.maquila_cortes
  for each row execute function public.maquila_touch();

-- ---------------------------------------------------------------------------
-- Los renglones. `pedido_id` null = ajuste manual (una nota de crédito por una
-- pieza mal hecha, una devolución de un corte anterior): por eso `concepto` e
-- `importe` pueden ir a pelo y el importe admite negativos.
-- ---------------------------------------------------------------------------
create table if not exists public.maquila_corte_renglones (
  id             uuid primary key default gen_random_uuid(),
  corte_id       uuid not null references public.maquila_cortes(id) on delete cascade,
  pedido_id      uuid references public.maquila_pedidos(id) on delete set null,
  concepto       text,
  modelo         text,
  acabado        text,
  cantidad       int not null default 1,
  costo_unitario numeric(12,2) not null default 0,
  importe        numeric(14,2) not null default 0,
  enviado_en     timestamptz,
  anulado        boolean not null default false,
  created_at     timestamptz not null default now()
);

comment on table public.maquila_corte_renglones is
  'Un renglón por pieza pagada. importe = costo_unitario × cantidad. pedido_id null = ajuste manual, y ahí el importe puede ser negativo.';

-- LA regla: un pedido no se le paga dos veces a Eduardo.
create unique index if not exists maquila_corte_renglon_pedido_uidx
  on public.maquila_corte_renglones (pedido_id)
  where pedido_id is not null and not anulado;

create index if not exists maquila_corte_renglon_corte_idx on public.maquila_corte_renglones (corte_id);

-- Qué anticipo se consumió en qué corte, y por cuánto.
create table if not exists public.maquila_corte_anticipos (
  corte_id    uuid not null references public.maquila_cortes(id) on delete cascade,
  anticipo_id uuid not null references public.maquila_anticipos(id) on delete cascade,
  monto       numeric(12,2) not null check (monto >= 0),
  anulado     boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (corte_id, anticipo_id)
);

create index if not exists maquila_corte_anticipo_idx on public.maquila_corte_anticipos (anticipo_id);

-- El saldo de cada anticipo, derivado. `security_invoker` para que herede la
-- RLS de quien pregunta en vez de la del dueño de la vista.
drop view if exists public.maquila_anticipos_saldo;
create view public.maquila_anticipos_saldo
with (security_invoker = true) as
  select a.id            as anticipo_id,
         a.monto,
         coalesce(sum(ca.monto) filter (where not ca.anulado), 0) as aplicado,
         a.monto - coalesce(sum(ca.monto) filter (where not ca.anulado), 0) as saldo
    from public.maquila_anticipos a
    left join public.maquila_corte_anticipos ca on ca.anticipo_id = a.id
   group by a.id, a.monto;

comment on view public.maquila_anticipos_saldo is
  'Cuánto queda a favor de cada anticipo. Derivado de lo aplicado en cortes no anulados: no hay columna de saldo que se pueda desincronizar.';

-- ---------------------------------------------------------------------------
-- 1. Calcular (o completar) el corte de un periodo.
-- ---------------------------------------------------------------------------
create or replace function public.maquila_calcular_corte(desde date, hasta date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.es_administrativo() then
    raise exception 'El corte de maquila lo hace administración.';
  end if;
  if desde is null or hasta is null or hasta < desde then
    raise exception 'El periodo del corte está al revés o incompleto.';
  end if;

  select id into v_id
    from public.maquila_cortes
   where periodo_desde = desde and periodo_hasta = hasta and estado <> 'cancelado'
   for update;

  if not found then
    insert into public.maquila_cortes (periodo_desde, periodo_hasta, created_by)
      values (desde, hasta, auth.uid())
      returning id into v_id;
  elsif (select estado from public.maquila_cortes where id = v_id) <> 'borrador' then
    raise exception 'Ese corte ya está cerrado: para recalcularlo, cancélalo y vuelve a empezar.';
  end if;

  -- Solo lo que salió en el periodo y todavía no está en ningún corte vivo.
  insert into public.maquila_corte_renglones
    (corte_id, pedido_id, concepto, modelo, acabado, cantidad, costo_unitario, importe, enviado_en)
  select v_id,
         p.id,
         coalesce(p.diseno, p.sku, 'Pieza de maquila'),
         p.modelo,
         p.acabado,
         p.cantidad,
         c.costo,
         c.costo * p.cantidad,
         p.enviado_en
    from public.maquila_pedidos p
    join public.maquila_pedido_costos c on c.pedido_id = p.id
   where p.estado in ('enviado','entregado')
     and p.enviado_en is not null
     and (p.enviado_en at time zone 'America/Mexico_City')::date between desde and hasta
     and c.costo is not null
     and not exists (
       select 1 from public.maquila_corte_renglones r
        where r.pedido_id = p.id and not r.anulado
     );

  perform public.maquila_recalcular_totales(v_id);
  return v_id;
end;
$$;
grant execute on function public.maquila_calcular_corte(date, date) to authenticated;

comment on function public.maquila_calcular_corte(date, date) is
  'Crea o completa el corte en borrador de un periodo con lo enviado que aún no se ha pagado. Re-ejecutable: los pedidos que llegan tarde entran en la siguiente pasada.';

-- ---------------------------------------------------------------------------
-- 2. Recalcular totales. Se usa desde calcular, cerrar y agregar un ajuste.
--
-- Lleva su propia guardia aunque solo la llamen las otras: es `security
-- definer` y está concedida a `authenticated`, así que sin el `if` cualquiera
-- podría invocarla a mano. Recalcular no falsea nada —suma los renglones que
-- ya existen—, pero una función definer sin candado es una puerta abierta
-- esperando a que alguien le encuentre un uso.
-- ---------------------------------------------------------------------------
create or replace function public.maquila_recalcular_totales(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_piezas    int;
  v_subtotal  numeric(14,2);
  v_anticipos numeric(14,2);
  v_tasa      numeric(5,4);
  v_iva       numeric(14,2);
begin
  if not public.es_administrativo() then
    raise exception 'Los totales del corte de maquila los lleva administración.';
  end if;

  select coalesce(sum(cantidad), 0), coalesce(sum(importe), 0)
    into v_piezas, v_subtotal
    from public.maquila_corte_renglones
   where corte_id = cid and not anulado;

  select coalesce(sum(monto), 0) into v_anticipos
    from public.maquila_corte_anticipos
   where corte_id = cid and not anulado;

  select iva_tasa into v_tasa from public.maquila_cortes where id = cid;
  v_iva := round(v_subtotal * coalesce(v_tasa, 0.16), 2);

  update public.maquila_cortes
     set piezas = v_piezas,
         subtotal = v_subtotal,
         iva = v_iva,
         anticipos_aplicados = v_anticipos,
         total = v_subtotal + v_iva - v_anticipos
   where id = cid;
end;
$$;
grant execute on function public.maquila_recalcular_totales(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Cerrar: aplica los anticipos y congela.
--
-- FIFO por fecha: se gasta primero lo más viejo. Es lo que espera cualquiera
-- que lleve una cuenta a favor, y evita que un anticipo quede eternamente sin
-- consumir mientras se consumen los nuevos.
-- ---------------------------------------------------------------------------
create or replace function public.maquila_cerrar_corte(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c        public.maquila_cortes;
  a        record;
  v_por_pagar numeric(14,2);
  v_toma      numeric(14,2);
begin
  if not public.es_administrativo() then
    raise exception 'Cerrar el corte de maquila le toca a administración.';
  end if;

  select * into c from public.maquila_cortes where id = cid for update;
  if not found then raise exception 'Ese corte ya no existe.'; end if;
  if c.estado <> 'borrador' then
    raise exception 'Ese corte ya está %.', c.estado;
  end if;
  if not exists (select 1 from public.maquila_corte_renglones where corte_id = cid and not anulado) then
    raise exception 'El corte no tiene renglones: calcúlalo antes de cerrarlo.';
  end if;

  perform public.maquila_recalcular_totales(cid);
  select * into c from public.maquila_cortes where id = cid;
  v_por_pagar := c.subtotal + c.iva;

  for a in
    select s.anticipo_id, s.saldo
      from public.maquila_anticipos_saldo s
      join public.maquila_anticipos an on an.id = s.anticipo_id
     where s.saldo > 0
     order by an.fecha, an.id
  loop
    exit when v_por_pagar <= 0;
    v_toma := least(a.saldo, v_por_pagar);

    insert into public.maquila_corte_anticipos (corte_id, anticipo_id, monto)
      values (cid, a.anticipo_id, v_toma)
    on conflict (corte_id, anticipo_id) do update
      set monto = excluded.monto, anulado = false;

    v_por_pagar := v_por_pagar - v_toma;
  end loop;

  perform public.maquila_recalcular_totales(cid);

  update public.maquila_cortes
     set estado = 'cerrado', cerrado_en = now(), cerrado_por = auth.uid()
   where id = cid;
end;
$$;
grant execute on function public.maquila_cerrar_corte(uuid) to authenticated;

comment on function public.maquila_cerrar_corte(uuid) is
  'Congela el corte: aplica los anticipos disponibles por FIFO de fecha y fija el total a pagar.';

-- ---------------------------------------------------------------------------
-- 4. Cancelar: anula, no borra. Los pedidos vuelven a estar disponibles para
--    otro corte y los anticipos recuperan su saldo.
-- ---------------------------------------------------------------------------
create or replace function public.maquila_cancelar_corte(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.maquila_cortes;
begin
  if not public.es_admin(auth.uid()) then
    raise exception 'Cancelar un corte ya calculado le toca a dirección.';
  end if;

  select * into c from public.maquila_cortes where id = cid for update;
  if not found then raise exception 'Ese corte ya no existe.'; end if;
  if c.estado = 'pagado' then
    raise exception 'Ese corte ya se pagó: si hubo un error, corrígelo con un ajuste en el siguiente.';
  end if;

  update public.maquila_corte_renglones set anulado = true where corte_id = cid;
  update public.maquila_corte_anticipos  set anulado = true where corte_id = cid;
  update public.maquila_cortes
     set estado = 'cancelado', piezas = 0, subtotal = 0, iva = 0,
         anticipos_aplicados = 0, total = 0
   where id = cid;
end;
$$;
grant execute on function public.maquila_cancelar_corte(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Ajuste manual: nota de crédito, penalización, pieza rehecha.
-- ---------------------------------------------------------------------------
create or replace function public.maquila_agregar_ajuste_corte(cid uuid, p_concepto text, p_importe numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.es_administrativo() then
    raise exception 'Los ajustes del corte los captura administración.';
  end if;
  if nullif(btrim(coalesce(p_concepto, '')), '') is null then
    raise exception 'Un ajuste sin concepto no se puede auditar: escribe de qué es.';
  end if;
  if (select estado from public.maquila_cortes where id = cid) <> 'borrador' then
    raise exception 'Ese corte ya no está en borrador.';
  end if;

  insert into public.maquila_corte_renglones (corte_id, concepto, cantidad, costo_unitario, importe)
    values (cid, btrim(p_concepto), 0, 0, p_importe)
    returning id into v_id;

  perform public.maquila_recalcular_totales(cid);
  return v_id;
end;
$$;
grant execute on function public.maquila_agregar_ajuste_corte(uuid, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Permisos + RLS: administración en todo. Aquí no entra nadie más.
-- ---------------------------------------------------------------------------
grant all on public.maquila_cortes            to authenticated, service_role;
grant all on public.maquila_corte_renglones   to authenticated, service_role;
grant all on public.maquila_corte_anticipos   to authenticated, service_role;
grant select on public.maquila_anticipos_saldo to authenticated, service_role;

alter table public.maquila_cortes            enable row level security;
alter table public.maquila_corte_renglones   enable row level security;
alter table public.maquila_corte_anticipos   enable row level security;

drop policy if exists "maquila cortes: ver (admin)" on public.maquila_cortes;
create policy "maquila cortes: ver (admin)" on public.maquila_cortes
  for select to authenticated using ((select public.es_administrativo()));

drop policy if exists "maquila cortes: gestionar (admin)" on public.maquila_cortes;
create policy "maquila cortes: gestionar (admin)" on public.maquila_cortes
  for all to authenticated
  using ((select public.es_administrativo()))
  with check ((select public.es_administrativo()));

drop policy if exists "maquila corte renglones: ver (admin)" on public.maquila_corte_renglones;
create policy "maquila corte renglones: ver (admin)" on public.maquila_corte_renglones
  for select to authenticated using ((select public.es_administrativo()));

drop policy if exists "maquila corte anticipos: ver (admin)" on public.maquila_corte_anticipos;
create policy "maquila corte anticipos: ver (admin)" on public.maquila_corte_anticipos
  for select to authenticated using ((select public.es_administrativo()));

-- Renglones y aplicaciones se escriben SOLO por las funciones de arriba: son
-- las que mantienen los totales cuadrados.
revoke insert, update, delete on public.maquila_corte_renglones from authenticated, anon;
revoke insert, update, delete on public.maquila_corte_anticipos  from authenticated, anon;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select proname from pg_proc where proname like 'maquila_%corte%';   -- 5
--
--   -- Un corte de prueba de la quincena en curso:
--   select public.maquila_calcular_corte(date_trunc('month', current_date)::date, current_date);
--   select periodo_desde, periodo_hasta, piezas, subtotal, iva, total, estado
--     from public.maquila_cortes order by created_at desc limit 5;
--
--   -- Los totales cuadran con sus renglones:
--   select c.id, c.subtotal, sum(r.importe) as suma_renglones
--     from public.maquila_cortes c
--     join public.maquila_corte_renglones r on r.corte_id = c.id and not r.anulado
--    group by c.id, c.subtotal having c.subtotal <> sum(r.importe);   -- vacío
--
--   -- Nadie se pagó dos veces:
--   select pedido_id, count(*) from public.maquila_corte_renglones
--    where pedido_id is not null and not anulado group by 1 having count(*) > 1;  -- vacío
-- ============================================================================
