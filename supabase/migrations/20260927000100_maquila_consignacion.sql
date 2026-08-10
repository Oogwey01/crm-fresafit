-- ============================================================================
-- 20260927000100_maquila_consignacion.sql
--   La bitácora del material en poder de Eduardo, y quién la mueve.
-- ----------------------------------------------------------------------------
-- Cuatro movimientos y ninguno más:
--
--   envio      Fresa Fit le manda piezas. Si el insumo tiene ficha, BAJA de
--              bodega con su renglón en stock_log, bajo el mismo lote.
--   consumo    Salió un pedido que la llevaba. Lo escribe un trigger, no una
--              persona: el descuento tiene que pasar sí o sí cuando la pieza
--              se va, aunque quien la marcó enviada haya sido el maquilero.
--   devolucion Regresa material sin usar. Vuelve a bodega si hay ficha.
--   ajuste     Corrección de conteo. NO toca bodega: inventariar stock que
--              nunca existió sería peor que el descuadre que corrige.
--
-- El candado contra el doble descuento es un índice único parcial sobre
-- (pedido_id, insumo_id) para los consumos: un webhook repetido, un doble
-- clic o un UPDATE que vuelva a pasar por el trigger no pueden gastar dos
-- veces la misma palanca.
--
-- NADA de aquí llama a propagarStock: mandarle palancas a Eduardo no cambia
-- lo publicado en ningún canal (ver CANALES_SOLO_LECTURA en ARQUITECTURA.md).
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.maquila_consignacion_movs (
  id               uuid primary key default gen_random_uuid(),
  insumo_id        uuid not null references public.maquila_insumos(id) on delete cascade,
  tipo             text not null check (tipo in ('envio','consumo','devolucion','ajuste')),
  -- Siempre positiva: el signo lo pone el `tipo`, para que sumar la columna no
  -- necesite saber la semántica de cada renglón.
  cantidad         numeric(12,2) not null check (cantidad >= 0),
  saldo_resultante numeric(12,2) not null,
  pedido_id        uuid references public.maquila_pedidos(id) on delete set null,
  -- Casa este renglón con su asiento en stock_log (mismo criterio que
  -- armar_conjunto). Null cuando el insumo no tiene ficha.
  lote             uuid,
  motivo           text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

comment on table public.maquila_consignacion_movs is
  'Bitácora del material en consignación con Eduardo. Append-only en la práctica: se corrige con un ajuste, no editando el pasado.';

create index if not exists maquila_cons_mov_insumo_idx on public.maquila_consignacion_movs (insumo_id, created_at desc);
create index if not exists maquila_cons_mov_pedido_idx on public.maquila_consignacion_movs (pedido_id);
create index if not exists maquila_cons_mov_autor_idx  on public.maquila_consignacion_movs (created_by);

-- EL candado del módulo: un pedido consume UNA vez de cada insumo.
create unique index if not exists maquila_cons_mov_consumo_uidx
  on public.maquila_consignacion_movs (pedido_id, insumo_id)
  where tipo = 'consumo';

-- ---------------------------------------------------------------------------
-- 1. Mandarle material. Asiento doble bodega → consignación.
-- ---------------------------------------------------------------------------
create or replace function public.maquila_enviar_insumo(iid uuid, n numeric, p_motivo text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_prod   uuid;
  v_nombre text;
  v_antes  int;
  v_lote   uuid := gen_random_uuid();
  v_saldo  numeric;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede mandarle material a la maquila.';
  end if;
  if n is null or n <= 0 then
    raise exception 'Di cuántas piezas le mandaste (tiene que ser más de cero).';
  end if;

  select producto_id, nombre into v_prod, v_nombre
    from public.maquila_insumos where id = iid and activo for update;
  if not found then
    raise exception 'Ese insumo de maquila ya no existe o está apagado.';
  end if;

  -- Con ficha, sale de bodega. La comprobación va ANTES del update para que el
  -- mensaje hable de piezas y no del CHECK de products.stock.
  if v_prod is not null then
    select stock into v_antes from public.products where id = v_prod for update;
    if not found then
      raise exception 'La ficha ligada a «%» ya no existe en el inventario.', v_nombre;
    end if;
    if v_antes < n then
      raise exception 'No alcanza: en bodega hay % de «%» y quieres mandar %.', v_antes, v_nombre, n;
    end if;

    update public.products set stock = stock - n::int where id = v_prod;
    insert into public.stock_log
      (producto_id, canal, origen, stock_anterior, stock_nuevo, lote, created_by)
      values (v_prod, 'crm', 'maquila_consignacion', v_antes, v_antes - n::int, v_lote, auth.uid());
  end if;

  insert into public.maquila_consignacion (insumo_id, saldo) values (iid, n)
    on conflict (insumo_id) do update
      set saldo = public.maquila_consignacion.saldo + n, updated_at = now()
    returning saldo into v_saldo;

  insert into public.maquila_consignacion_movs
    (insumo_id, tipo, cantidad, saldo_resultante, lote, motivo, created_by)
    values (iid, 'envio', n, v_saldo, case when v_prod is null then null else v_lote end,
            nullif(btrim(coalesce(p_motivo, '')), ''), auth.uid());

  return v_saldo;
end;
$$;
grant execute on function public.maquila_enviar_insumo(uuid, numeric, text) to authenticated;

comment on function public.maquila_enviar_insumo(uuid, numeric, text) is
  'Manda material a la consignación de Eduardo: sube su saldo y, si el insumo tiene ficha, lo descuenta de bodega con su renglón en stock_log. Devuelve el saldo nuevo.';

-- ---------------------------------------------------------------------------
-- 2. Devolución: regresa material sin usar.
-- ---------------------------------------------------------------------------
create or replace function public.maquila_devolver_insumo(iid uuid, n numeric, p_motivo text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_prod  uuid;
  v_antes int;
  v_lote  uuid := gen_random_uuid();
  v_saldo numeric;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede registrar una devolución de maquila.';
  end if;
  if n is null or n <= 0 then
    raise exception 'Di cuántas piezas regresaron.';
  end if;

  select producto_id into v_prod from public.maquila_insumos where id = iid for update;
  if not found then
    raise exception 'Ese insumo de maquila ya no existe.';
  end if;

  if v_prod is not null then
    select stock into v_antes from public.products where id = v_prod for update;
    if found then
      update public.products set stock = stock + n::int where id = v_prod;
      insert into public.stock_log
        (producto_id, canal, origen, stock_anterior, stock_nuevo, lote, created_by)
        values (v_prod, 'crm', 'maquila_consignacion_dev', v_antes, v_antes + n::int, v_lote, auth.uid());
    end if;
  end if;

  insert into public.maquila_consignacion (insumo_id, saldo) values (iid, -n)
    on conflict (insumo_id) do update
      set saldo = public.maquila_consignacion.saldo - n, updated_at = now()
    returning saldo into v_saldo;

  insert into public.maquila_consignacion_movs
    (insumo_id, tipo, cantidad, saldo_resultante, lote, motivo, created_by)
    values (iid, 'devolucion', n, v_saldo, case when v_prod is null then null else v_lote end,
            nullif(btrim(coalesce(p_motivo, '')), ''), auth.uid());

  return v_saldo;
end;
$$;
grant execute on function public.maquila_devolver_insumo(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ajuste de conteo. Deja el saldo en lo que Eduardo contó, sin tocar bodega.
-- ---------------------------------------------------------------------------
create or replace function public.maquila_ajustar_consignacion(iid uuid, saldo_nuevo numeric, p_motivo text)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_antes numeric;
  v_delta numeric;
begin
  if not public.es_administrativo() then
    raise exception 'Ajustar el conteo de la consignación le toca a administración.';
  end if;
  if saldo_nuevo is null then
    raise exception 'Di en cuánto quedó el conteo.';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Un ajuste sin motivo no se puede auditar: escribe por qué.';
  end if;

  select saldo into v_antes from public.maquila_consignacion where insumo_id = iid for update;
  if not found then
    insert into public.maquila_consignacion (insumo_id, saldo) values (iid, 0);
    v_antes := 0;
  end if;
  v_delta := saldo_nuevo - v_antes;

  update public.maquila_consignacion
     set saldo = saldo_nuevo, updated_at = now()
   where insumo_id = iid;

  insert into public.maquila_consignacion_movs
    (insumo_id, tipo, cantidad, saldo_resultante, motivo, created_by)
    values (iid, 'ajuste', abs(v_delta), saldo_nuevo,
            btrim(p_motivo) || ' (de ' || v_antes || ' a ' || saldo_nuevo || ')', auth.uid());

  return saldo_nuevo;
end;
$$;
grant execute on function public.maquila_ajustar_consignacion(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. El consumo automático: la pieza salió, el material se gastó.
--
-- AFTER UPDATE y escribiendo solo en las tablas de consignación: no reentra en
-- validar_cambio_maquila. `security definer` porque quien marca enviado suele
-- ser el maquilero, y su RLS no le da escritura aquí — ni se la va a dar:
-- gastar material no es un acto suyo, es una consecuencia.
-- ---------------------------------------------------------------------------
create or replace function public.consumir_insumos_maquila()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r       record;
  v_saldo numeric;
begin
  -- Solo el instante en que la pieza sale. Un segundo update de la misma fila
  -- ya no entra (enviado_en deja de ser null).
  if new.enviado_en is null or old.enviado_en is not null then
    return new;
  end if;

  for r in
    select i.id, sum(x.n)::numeric as n
      from (
        select case when new.requiere_palanca and new.palanca_color is not null
                    then 'palanca_' || new.palanca_color end as clave,
               new.cantidad::numeric as n
        union all
        select case when new.combo in ('munequeras','ambos') then 'munequeras' end, new.cantidad
        union all
        select case when new.combo in ('straps','ambos') then 'straps' end, new.cantidad
      ) x
      join public.maquila_insumos i on i.clave = x.clave and i.activo
     where x.clave is not null
     group by i.id
     order by i.id
  loop
    -- El candado va ANTES de mover el saldo, no en un `on conflict do nothing`
    -- del insert de abajo: ahí el saldo ya habría bajado y solo se perdería el
    -- renglón de la bitácora — un descuadre mudo. Pasa de verdad si alguien
    -- del equipo des-marca un envío y lo vuelve a marcar.
    if exists (
      select 1 from public.maquila_consignacion_movs
       where pedido_id = new.id and insumo_id = r.id and tipo = 'consumo'
    ) then
      continue;
    end if;

    insert into public.maquila_consignacion (insumo_id, saldo) values (r.id, -r.n)
      on conflict (insumo_id) do update
        set saldo = public.maquila_consignacion.saldo - r.n, updated_at = now()
      returning saldo into v_saldo;

    insert into public.maquila_consignacion_movs
      (insumo_id, tipo, cantidad, saldo_resultante, pedido_id, motivo, created_by)
      values (r.id, 'consumo', r.n, v_saldo, new.id, 'salió el pedido', auth.uid())
      on conflict do nothing;   -- maquila_cons_mov_consumo_uidx: la red de abajo
  end loop;

  return new;
end;
$$;

drop trigger if exists maquila_pedidos_consignacion_trg on public.maquila_pedidos;
create trigger maquila_pedidos_consignacion_trg
  after update on public.maquila_pedidos
  for each row execute function public.consumir_insumos_maquila();

-- ---------------------------------------------------------------------------
-- Permisos + RLS de la bitácora. La lee el equipo y también Eduardo (es su
-- material: tiene que poder cuadrar). Escribir, solo las RPC.
-- ---------------------------------------------------------------------------
grant all on public.maquila_consignacion_movs to authenticated, service_role;

alter table public.maquila_consignacion_movs enable row level security;

drop policy if exists "maquila consignacion movs: ver (interno)" on public.maquila_consignacion_movs;
create policy "maquila consignacion movs: ver (interno)" on public.maquila_consignacion_movs
  for select to authenticated using ((select public.es_interno()));

drop policy if exists "maquila consignacion movs: ver (maquilero)" on public.maquila_consignacion_movs;
create policy "maquila consignacion movs: ver (maquilero)" on public.maquila_consignacion_movs
  for select to authenticated using ((select public.es_maquilero()));

revoke insert, update, delete on public.maquila_consignacion_movs from authenticated, anon;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select proname, prosecdef from pg_proc
--    where proname like 'maquila_%insumo%' or proname = 'maquila_ajustar_consignacion';
--   select tgname from pg_trigger
--    where tgrelid = 'public.maquila_pedidos'::regclass and not tgisinternal;
--     -- ahora CINCO: touch, validar, log, guia y consignacion
--
--   -- El saldo cuadra con su bitácora (si no, hubo escritura fuera de las RPC):
--   select i.clave, c.saldo,
--          sum(case when m.tipo in ('envio') then m.cantidad
--                   when m.tipo in ('consumo','devolucion') then -m.cantidad
--                   else 0 end) as neto_sin_ajustes
--     from public.maquila_insumos i
--     join public.maquila_consignacion c on c.insumo_id = i.id
--     left join public.maquila_consignacion_movs m on m.insumo_id = i.id
--    group by 1, 2 order by 1;
--
--   -- Ningún pedido gastó dos veces:
--   select pedido_id, insumo_id, count(*) from public.maquila_consignacion_movs
--    where tipo = 'consumo' group by 1, 2 having count(*) > 1;   -- vacío
-- ============================================================================
