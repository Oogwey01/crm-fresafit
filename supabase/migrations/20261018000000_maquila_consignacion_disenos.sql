-- ============================================================================
-- Consignación de maquila POR DISEÑO (junta 13/08/2026).
--
-- «Le vamos a enviar varios diseños de muñequeras: tenemos que poner 10 de
-- Akatsuki Pro» — el saldo genérico por insumo se queda (un descuadre nunca
-- frena un envío), pero cada movimiento puede decir de QUÉ diseño era:
--
--   * maquila_consignacion_movs.diseno_id → maquila_disenos (SET NULL).
--   * maquila_enviar_insumo / maquila_devolver_insumo ganan p_diseno_id.
--     Se DROPEAN las firmas viejas antes de crear las nuevas: si quedaran las
--     dos, un llamado con tres argumentos sería ambiguo para Postgres.
--
-- El desglose por diseño se lee agrupando la bitácora; los movimientos
-- históricos quedan como «sin especificar». Idempotente.
-- ============================================================================

set lock_timeout = '10s';

alter table public.maquila_consignacion_movs
  add column if not exists diseno_id uuid references public.maquila_disenos(id) on delete set null;

create index if not exists mcm_diseno_idx
  on public.maquila_consignacion_movs(diseno_id) where diseno_id is not null;

-- ---------------------------------------------------------------------------
-- Enviar material, ahora con diseño opcional.
-- ---------------------------------------------------------------------------
drop function if exists public.maquila_enviar_insumo(uuid, numeric, text);

create or replace function public.maquila_enviar_insumo(
  iid uuid, n numeric, p_motivo text default null, p_diseno_id uuid default null
)
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
    (insumo_id, tipo, cantidad, saldo_resultante, lote, motivo, diseno_id, created_by)
    values (iid, 'envio', n, v_saldo, case when v_prod is null then null else v_lote end,
            nullif(btrim(coalesce(p_motivo, '')), ''), p_diseno_id, auth.uid());

  return v_saldo;
end;
$$;

grant execute on function public.maquila_enviar_insumo(uuid, numeric, text, uuid) to authenticated;

comment on function public.maquila_enviar_insumo(uuid, numeric, text, uuid) is
  'Manda material a la consignación de Eduardo (asiento doble con bodega si el insumo tiene ficha). p_diseno_id = de qué diseño eran las piezas, opcional.';

-- ---------------------------------------------------------------------------
-- Devolución, con el mismo diseño opcional.
-- ---------------------------------------------------------------------------
drop function if exists public.maquila_devolver_insumo(uuid, numeric, text);

create or replace function public.maquila_devolver_insumo(
  iid uuid, n numeric, p_motivo text default null, p_diseno_id uuid default null
)
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
    (insumo_id, tipo, cantidad, saldo_resultante, lote, motivo, diseno_id, created_by)
    values (iid, 'devolucion', n, v_saldo, case when v_prod is null then null else v_lote end,
            nullif(btrim(coalesce(p_motivo, '')), ''), p_diseno_id, auth.uid());

  return v_saldo;
end;
$$;

grant execute on function public.maquila_devolver_insumo(uuid, numeric, text, uuid) to authenticated;

comment on function public.maquila_devolver_insumo(uuid, numeric, text, uuid) is
  'Registra material que regresó de la consignación. p_diseno_id = de qué diseño eran las piezas, opcional.';

notify pgrst, 'reload schema';
