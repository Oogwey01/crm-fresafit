-- ============================================================================
-- 20260908000200_armar_conjunto.sql — Armar, deshacer y saldar con los canales
-- ----------------------------------------------------------------------------
-- Armar un conjunto es un asiento doble: bajan las piezas, sube la ficha del
-- conjunto. Las dos mitades tienen que pasar juntas o no pasar, por eso viven
-- en una función y no en tres llamadas desde el navegador: plpgsql = una
-- transacción. Mismo criterio que `descontar_recepcion` (20260831000000).
--
-- Tres cosas que no son obvias y que conviene no re-discutir:
--
--   * CANDADOS EN ORDEN DE ID. Una pieza como MQR004 está en media docena de
--     conjuntos. Dos personas armando a la vez conjuntos que la comparten se
--     abrazarían si cada transacción tomara los candados en su propio orden.
--     Tomarlos siempre ordenados por id vuelve el abrazo imposible.
--
--   * LA RECETA SE AGREGA POR FICHA. Dos renglones distintos de la receta pueden
--     apuntar a la misma ficha (pasa en cuanto se ligan los nombres sueltos de
--     la hoja). Sin `group by producto_id` el segundo UPDATE pisaría al primero
--     y se descontaría de menos.
--
--   * ARMAR NO ES IDEMPOTENTE, Y ESTÁ BIEN. Armar 5 dos veces son 10 conjuntos
--     armados de verdad; volverlo no-op sería peor error que el que evita. Lo
--     idempotente es DESHACER, y su candado es el índice único de `revierte_a`.
--
-- Deshacer revierte el `detalle` guardado, no la receta de hoy: entre el armado
-- y el arrepentimiento alguien pudo editar el conjunto.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Armar.
-- ---------------------------------------------------------------------------
create or replace function public.armar_conjunto(cid uuid, n int, p_nota text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cj          public.conjuntos;
  comp        record;
  antes       int;
  ficha_antes int;
  v_lote      uuid := gen_random_uuid();
  v_detalle   jsonb := '[]'::jsonb;
  v_armado    uuid;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede armar conjuntos.';
  end if;
  if n is null or n <= 0 then
    raise exception 'Di cuántos conjuntos armaste (tiene que ser más de cero).';
  end if;

  select * into cj from public.conjuntos where id = cid for update;
  if not found then
    raise exception 'Ese conjunto ya no existe.';
  end if;

  if cj.producto_id is null then
    raise exception 'El conjunto % todavía no tiene ficha en el inventario: ahí es donde se acredita lo que armes. Ábrelo y lígalo a su SKU antes de armarlo.', cj.sku;
  end if;
  if not exists (select 1 from public.conjunto_componentes where conjunto_id = cid) then
    raise exception 'El conjunto % no tiene piezas registradas: primero dile con qué se arma.', cj.sku;
  end if;
  if exists (select 1 from public.conjunto_componentes where conjunto_id = cid and producto_id is null) then
    raise exception 'El conjunto % tiene piezas sin ficha ligada. Usa «Ligar componentes» para resolverlas y vuelve.', cj.sku;
  end if;
  -- Barato de comprobar, y si pasara el descuadre sería silencioso.
  if exists (select 1 from public.conjunto_componentes
              where conjunto_id = cid and producto_id = cj.producto_id) then
    raise exception 'El conjunto % se tiene a sí mismo como pieza: revisa su receta.', cj.sku;
  end if;

  -- Candados de todas las fichas implicadas, en orden de id. Ver la cabecera.
  perform p.id
     from public.products p
    where p.id = cj.producto_id
       or p.id in (select producto_id from public.conjunto_componentes
                    where conjunto_id = cid and producto_id is not null)
    order by p.id
      for update;

  -- Primera pasada: comprobar que alcanza para todo ANTES de mover nada. La
  -- transacción revertiría igual, pero así el mensaje habla de la pieza que
  -- falta y no de la que se alcanzó a descontar.
  for comp in
    select c.producto_id,
           sum(c.cantidad)::int as por_unidad,
           p.sku, p.nombre, p.stock
      from public.conjunto_componentes c
      join public.products p on p.id = c.producto_id
     where c.conjunto_id = cid
     group by c.producto_id, p.sku, p.nombre, p.stock
     order by c.producto_id
  loop
    if comp.stock < comp.por_unidad * n then
      raise exception 'No alcanza para armar % de %: «%» (%) necesita % piezas y solo hay %.',
        n, cj.sku, comp.nombre, coalesce(comp.sku, 'sin SKU'), comp.por_unidad * n, comp.stock;
    end if;
  end loop;

  -- Segunda pasada: descontar y dejar rastro.
  for comp in
    select c.producto_id,
           sum(c.cantidad)::int as por_unidad,
           p.sku, p.nombre
      from public.conjunto_componentes c
      join public.products p on p.id = c.producto_id
     where c.conjunto_id = cid
     group by c.producto_id, p.sku, p.nombre
     order by c.producto_id
  loop
    select stock into antes from public.products where id = comp.producto_id;

    update public.products
       set stock = stock - comp.por_unidad * n
     where id = comp.producto_id;

    insert into public.stock_log
      (producto_id, canal, origen, stock_anterior, stock_nuevo, lote, created_by)
      values (comp.producto_id, 'crm', 'conjunto_armado',
              antes, antes - comp.por_unidad * n, v_lote, auth.uid());

    v_detalle := v_detalle || jsonb_build_object(
      'producto_id',    comp.producto_id,
      'sku',            comp.sku,
      'nombre',         comp.nombre,
      'cantidad',       comp.por_unidad * n,
      'stock_anterior', antes,
      'stock_nuevo',    antes - comp.por_unidad * n);
  end loop;

  -- Acreditar la ficha del conjunto, con el MISMO lote que sus piezas.
  select stock into ficha_antes from public.products where id = cj.producto_id;
  update public.products set stock = stock + n where id = cj.producto_id;
  insert into public.stock_log
    (producto_id, canal, origen, stock_anterior, stock_nuevo, lote, created_by)
    values (cj.producto_id, 'crm', 'conjunto_armado',
            ficha_antes, ficha_antes + n, v_lote, auth.uid());

  insert into public.conjunto_armados
    (conjunto_id, sku_conjunto, producto_id, tipo, cantidad, lote, detalle, nota, created_by)
    values (cid, cj.sku, cj.producto_id, 'armado', n, v_lote, v_detalle,
            nullif(btrim(coalesce(p_nota, '')), ''), auth.uid())
    returning id into v_armado;

  return v_armado;
end;
$$;
grant execute on function public.armar_conjunto(uuid, int, text) to authenticated;

comment on function public.armar_conjunto(uuid, int, text) is
  'Registra un armado de bodega: descuenta las piezas, acredita la ficha del conjunto y deja los renglones de stock_log bajo un mismo lote. Devuelve el id del armado.';

-- ---------------------------------------------------------------------------
-- 2. Deshacer un armado.
-- ---------------------------------------------------------------------------
create or replace function public.desarmar_conjunto(aid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  a           public.conjunto_armados;
  pieza       record;
  antes       int;
  ficha_antes int;
  v_lote      uuid := gen_random_uuid();
  v_detalle   jsonb := '[]'::jsonb;
  v_nuevo     uuid;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede deshacer un armado.';
  end if;

  -- El candado de fila es lo que serializa dos «Deshacer» simultáneos; el
  -- índice único de `revierte_a` es la red por debajo.
  select * into a from public.conjunto_armados where id = aid for update;
  if not found then
    raise exception 'Ese armado ya no existe.';
  end if;
  if a.tipo <> 'armado' then
    raise exception 'Eso ya es un desarme: no se deshace un desarme.';
  end if;
  if exists (select 1 from public.conjunto_armados where revierte_a = aid) then
    raise exception 'Ese armado ya se deshizo.';
  end if;
  if a.producto_id is null then
    raise exception 'La ficha de % ya no existe en el inventario: no hay de dónde descontar los conjuntos armados.', a.sku_conjunto;
  end if;

  perform p.id
     from public.products p
    where p.id = a.producto_id
       or p.id in (select (x->>'producto_id')::uuid from jsonb_array_elements(a.detalle) x)
    order by p.id
      for update;

  select stock into ficha_antes from public.products where id = a.producto_id;
  if ficha_antes < a.cantidad then
    raise exception 'Ya no hay % piezas de % en el inventario (quedan %): se vendieron o se ajustaron. Solo se puede deshacer un armado que siga completo.',
      a.cantidad, a.sku_conjunto, ficha_antes;
  end if;

  update public.products set stock = stock - a.cantidad where id = a.producto_id;
  insert into public.stock_log
    (producto_id, canal, origen, stock_anterior, stock_nuevo, lote, created_by)
    values (a.producto_id, 'crm', 'conjunto_desarmado',
            ficha_antes, ficha_antes - a.cantidad, v_lote, auth.uid());

  -- Devolver las piezas SEGÚN LA FOTO del armado, no según la receta de hoy.
  for pieza in
    select (x->>'producto_id')::uuid as pid,
           (x->>'cantidad')::int     as cant,
           x->>'sku'                 as sku,
           x->>'nombre'              as nombre
      from jsonb_array_elements(a.detalle) x
     order by 1
  loop
    select stock into antes from public.products where id = pieza.pid;
    if not found then
      continue;  -- la ficha de esa pieza se borró; no hay dónde devolverla
    end if;

    update public.products set stock = stock + pieza.cant where id = pieza.pid;
    insert into public.stock_log
      (producto_id, canal, origen, stock_anterior, stock_nuevo, lote, created_by)
      values (pieza.pid, 'crm', 'conjunto_desarmado',
              antes, antes + pieza.cant, v_lote, auth.uid());

    v_detalle := v_detalle || jsonb_build_object(
      'producto_id',    pieza.pid,
      'sku',            pieza.sku,
      'nombre',         pieza.nombre,
      'cantidad',       pieza.cant,
      'stock_anterior', antes,
      'stock_nuevo',    antes + pieza.cant);
  end loop;

  -- Si el armado NUNCA llegó a los canales, el par se cancela solo: ninguno de
  -- los dos le debe nada a nadie y los dos salen de «Por subir». Si el armado sí
  -- se había subido, el desarme nace pendiente —hay que BAJAR ese stock allá—.
  insert into public.conjunto_armados
    (conjunto_id, sku_conjunto, producto_id, tipo, cantidad, lote, detalle,
     revierte_a, subido_en, subido_por, created_by)
    values (a.conjunto_id, a.sku_conjunto, a.producto_id, 'desarme', a.cantidad,
            v_lote, v_detalle, aid,
            case when a.subido_en is null then now() end,
            case when a.subido_en is null then auth.uid() end,
            auth.uid())
    returning id into v_nuevo;

  if a.subido_en is null then
    update public.conjunto_armados
       set subido_en = now(), subido_por = auth.uid()
     where id = aid;
  end if;

  return v_nuevo;
end;
$$;
grant execute on function public.desarmar_conjunto(uuid) to authenticated;

comment on function public.desarmar_conjunto(uuid) is
  'Revierte un armado usando la foto guardada en su `detalle`: devuelve las piezas y descuenta la ficha del conjunto. Un armado solo se deshace una vez.';

-- ---------------------------------------------------------------------------
-- 3. Saldar la cuenta con los canales.
--    El CRM no escribe stock en Tienda Nube, Mercado Libre ni TikTok, así que
--    lo que se arma aquí se captura allá a mano. Esto marca lo que ya se subió.
-- ---------------------------------------------------------------------------
create or replace function public.marcar_conjunto_subido(cid uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede marcar lo que ya se subió.';
  end if;

  update public.conjunto_armados a
     set subido_en = now(), subido_por = auth.uid()
   where a.conjunto_id = cid
     and a.subido_en is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function public.marcar_conjunto_subido(uuid) to authenticated;

comment on function public.marcar_conjunto_subido(uuid) is
  'Marca como capturados en los canales todos los movimientos pendientes de un conjunto. Devuelve cuántos renglones se marcaron.';

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- VERIFICACIÓN
-- ----------------------------------------------------------------------------
-- Las tres funciones existen y son security definer:
--   select proname, prosecdef from pg_proc
--    where proname in ('armar_conjunto','desarmar_conjunto','marcar_conjunto_subido');
--
-- Tras un armado: N+1 renglones bajo un mismo lote, todos en canal 'crm'.
--   select origen, canal, count(*) as renglones, count(distinct lote) as lotes
--     from public.stock_log
--    where origen in ('conjunto_armado','conjunto_desarmado')
--    group by 1, 2;
--
-- Cuadre: lo acreditado a cada ficha == armados − desarmes.
--   select sku_conjunto,
--          sum(case when tipo = 'armado' then cantidad else -cantidad end) as neto
--     from public.conjunto_armados group by 1 order by 1;
--
-- Nadie quedó en negativo:
--   select id, sku, stock from public.products where stock < 0;
