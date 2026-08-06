-- ============================================================================
-- Fresafit CRM — Las ventas de TikTok mueven el inventario de TikTok
-- ----------------------------------------------------------------------------
-- TikTok es el canal que más vende (515 órdenes en 30 días) y hasta hoy era el
-- único que no movía ningún número: su stock se llevaba a mano y el CRM solo lo
-- miraba una vez al día, cuando la pasada de las 07:00 copiaba lo que TikTok
-- reportaba. Entre venta y venta, el número del CRM envejecía.
--
-- LA REGLA QUE NO SE ROMPE NUNCA: una venta de TikTok NO toca la bodega.
-- El catálogo de TikTok es un almacén aparte del de bodega (misma prenda, dos
-- inventarios), y ya pasó una vez que TikTok escribiera encima de una ficha
-- cuyo dueño era otro canal: el incidente de MQR004, que borró 27 unidades el
-- 18/07. Según cómo viva la ficha:
--
--   Ficha DELEGADA (`tiktok_product_id` no nulo y SIN Tienda Nube ni Mercado
--   Libre) → su `products.stock` ES el almacén de TikTok. Ahí sí se descuenta.
--
--   Ficha MIXTA (además vive en Tienda Nube o Mercado Libre) → se descuenta de
--   `products.tiktok_stock`, que es el número propio de la publicación de
--   TikTok. `products.stock` es BODEGA y no se toca jamás.
--
--   Ficha MIXTA que TikTok nunca reportó (`tiktok_stock` null) → no se toca
--   nada. No hay base sobre la que restar, y escribir 0 inventaría un dato que
--   además alimenta el cálculo de «Qué pedir». Se devuelve `almacen='sin_dato'`
--   para que el llamador lo cuente, y la pasada nocturna la poblará.
--
-- Exigir `tiktok_product_id is not null` para lo delegado importa: una ficha
-- huérfana creada a mano en el CRM (sin ningún canal) pasaría un «solo TikTok»
-- ingenuo, y su `stock` sí es bodega. Es la misma condición que ya usa
-- `esTikTokDelegado()` en lib/inventario/reabastecimiento.ts.
--
-- El movimiento queda en `stock_log` con canal 'tiktok_shop' y origen
-- 'venta_tiktok' / 'cancelacion_tiktok'. El canal responde «qué almacén se
-- movió», y en las dos formas de ficha la respuesta es la misma: el de TikTok.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase, y las
-- veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 0. Guarda previa: el ledger tiene que admitir el canal de TikTok.
--    Lo añadió 20260829000000_higiene.sql. Como aquí las migraciones se pegan a
--    mano, se comprueba y se aborta con un mensaje que dice qué correr antes,
--    en vez de dejar que reviente después dentro de un try/catch de TypeScript
--    donde el error muere en la consola de Vercel.
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.stock_log'::regclass
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ilike '%canal%'
   limit 1;

  if v_def is not null and v_def not ilike '%tiktok_shop%' then
    raise exception 'stock_log.canal todavía no admite tiktok_shop. Corre antes 20260829000000_higiene.sql.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. El núcleo. Una sola función con signo y dos envoltorios, por la misma
--    razón que `descontar_recepcion_lote` delega en `descontar_recepcion`: que
--    no puedan quedar dos versiones de cómo se suma.
--
--    Va con bucle y `for update`, no con CTE como las RPC de ventas de Tienda
--    Nube y Mercado Libre, por dos motivos:
--      · hay que LEER el estado de la ficha para decidir qué columna tocar, y
--      · una CTE `antes` mira un snapshot que el UPDATE puede no respetar bajo
--        concurrencia, dejando un `stock_anterior` mentiroso en el ledger.
--    Son 1-3 renglones por webhook: el bucle no cuesta nada.
--
--    El `order by` del cursor da un orden de bloqueo estable: dos webhooks
--    simultáneos que toquen los mismos productos no se traban entre sí.
-- ---------------------------------------------------------------------------
drop function if exists public.mover_stock_tiktok(jsonb, text, int);

create function public.mover_stock_tiktok(items jsonb, p_origen text, p_signo int)
returns table (
  producto uuid,
  sku      text,
  almacen  text,   -- 'stock' | 'tiktok_stock' | 'sin_dato'
  anterior int,
  nuevo    int,
  movido   int
)
language plpgsql security definer set search_path = public as $$
declare
  v_lote     uuid := gen_random_uuid();
  r          record;
  v_sku      text;
  v_stock    int;
  v_tiktok   int;
  v_delegada boolean;
begin
  if p_signo is null or p_signo not in (-1, 1) then
    raise exception 'mover_stock_tiktok: p_signo debe ser -1 (venta) o 1 (devolución); llegó %', p_signo;
  end if;

  for r in
    -- Suma por producto: una orden puede traer varias líneas del mismo artículo.
    select x.producto_id as pid, sum(x.cantidad)::int as cantidad
      from jsonb_to_recordset(coalesce(items, '[]'::jsonb)) as x(producto_id uuid, cantidad int)
     where x.producto_id is not null and x.cantidad > 0
     group by x.producto_id
     order by 1
  loop
    select p.sku, p.stock, p.tiktok_stock,
           (p.tiktok_product_id is not null
            and p.tiendanube_variant_id is null
            and p.meli_item_id is null)
      into v_sku, v_stock, v_tiktok, v_delegada
      from public.products p
     where p.id = r.pid
     for update;

    -- Producto borrado entre la venta y esto: no hay nada que mover.
    if not found then continue; end if;

    producto := r.pid;
    sku      := v_sku;
    movido   := r.cantidad;

    if v_delegada then
      -- Ficha que vive SOLO en TikTok: aquí `stock` ES el almacén de TikTok.
      almacen  := 'stock';
      anterior := v_stock;
      nuevo    := greatest(0, v_stock + p_signo * r.cantidad);
      update public.products set stock = nuevo where id = r.pid;

    elsif v_tiktok is not null then
      -- Ficha MIXTA: `stock` es BODEGA y no se toca (incidente MQR004).
      almacen  := 'tiktok_stock';
      anterior := v_tiktok;
      nuevo    := greatest(0, v_tiktok + p_signo * r.cantidad);
      update public.products set tiktok_stock = nuevo where id = r.pid;

    else
      -- Mixta sin número propio observado todavía. Se informa y se deja intacta:
      -- un ledger no anota movimientos que no ocurrieron.
      almacen  := 'sin_dato';
      anterior := null;
      nuevo    := null;
      return next;
      continue;
    end if;

    -- `created_by` se queda en NULL a propósito: esto corre con el service role
    -- desde webhooks y crons, donde no hay persona detrás. Mismo criterio que
    -- las RPC de ventas (ver 20260831000000_stock_log_autor.sql).
    insert into public.stock_log (producto_id, canal, origen, stock_anterior, stock_nuevo, lote)
      values (r.pid, 'tiktok_shop', p_origen, anterior, nuevo, v_lote);

    return next;
  end loop;
end;
$$;

comment on function public.mover_stock_tiktok(jsonb, text, int) is
  'Mueve el inventario de TikTok (products.stock si la ficha es delegada, products.tiktok_stock si es mixta) y deja rastro en stock_log. NUNCA toca el stock de bodega de una ficha mixta. p_signo: -1 venta, +1 devolución. No llamar directo: usar descontar_stock_tiktok / devolver_stock_tiktok.';

-- ---------------------------------------------------------------------------
-- 2. Los dos envoltorios que sí se llaman desde la app.
-- ---------------------------------------------------------------------------
drop function if exists public.descontar_stock_tiktok(jsonb, text);
drop function if exists public.devolver_stock_tiktok(jsonb, text);

create function public.descontar_stock_tiktok(items jsonb, p_origen text default 'venta_tiktok')
returns table (producto uuid, sku text, almacen text, anterior int, nuevo int, movido int)
language sql security definer set search_path = public as $$
  select * from public.mover_stock_tiktok(items, p_origen, -1);
$$;

create function public.devolver_stock_tiktok(items jsonb, p_origen text default 'cancelacion_tiktok')
returns table (producto uuid, sku text, almacen text, anterior int, nuevo int, movido int)
language sql security definer set search_path = public as $$
  select * from public.mover_stock_tiktok(items, p_origen, 1);
$$;

-- ---------------------------------------------------------------------------
-- 3. Permisos. Postgres concede EXECUTE a PUBLIC por defecto, y estas funciones
--    son SECURITY DEFINER: sin el revoke, cualquiera con sesión podría mover
--    inventario con un POST a /rest/v1/rpc/... Solo las llama el servidor.
--
--    De paso se cierra lo mismo en las dos RPC de ventas, que nacieron sin
--    revoke. Verificado que solo se invocan con el service role
--    (lib/tiendanube/ventas.ts y lib/mercadolibre/ventas.ts), así que revocarlas
--    no rompe ningún flujo.
--
--    NO se tocan `descontar_recepcion`, `descontar_recepcion_lote`,
--    `recibir_pedido_proveedor` ni `mover_insumo`: esas SÍ se llaman con la
--    sesión del usuario desde Bodega y Proveedores, y quitarles el execute
--    dejaría al equipo sin poder recibir mercancía.
--
--    El revoke va por catálogo y no con la firma escrita a mano, para que
--    aplique aunque alguna función tenga hoy una firma distinta a la del
--    archivo (aquí las migraciones se pegan a mano).
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'mover_stock_tiktok', 'descontar_stock_tiktok', 'devolver_stock_tiktok',
         'descontar_stock_ventas', 'devolver_stock_ventas'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
    execute format('grant execute on function %s to service_role', f.firma);
    raise notice 'permisos ajustados: %', f.firma;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Índice para el historial de la pantalla de Inventario, que ahora abre
--    mostrando SOLO los movimientos reales. Las puestas al día son el 93% de la
--    tabla (991 de 1061 renglones en 30 días), así que sin índice parcial el
--    filtro obliga a recorrerlas todas para descartarlas.
-- ---------------------------------------------------------------------------
create index if not exists stock_log_reales_idx
  on public.stock_log (creado_en desc)
  where origen not in ('tiendanube_sync', 'mercadolibre_sync', 'tiktok_sync', 'tiktok_stock');

-- PostgREST cachea el esquema: sin esto, las RPC nuevas responden 404 hasta que
-- el pool recicle solo.
notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
-- 1) Las tres formas de ficha, con un ensayo que NO deja rastro.
--
--    Elegir un id de cada tipo:
--
--    -- delegada (solo TikTok):
--    select id, sku, stock, tiktok_stock from public.products
--     where tiktok_product_id is not null
--       and tiendanube_variant_id is null and meli_item_id is null limit 3;
--
--    -- mixta CON número de TikTok:
--    select id, sku, stock, tiktok_stock from public.products
--     where tiktok_stock is not null
--       and (tiendanube_variant_id is not null or meli_item_id is not null) limit 3;
--
--    Y para cada una:
--
--    begin;
--      select * from public.descontar_stock_tiktok(
--        '[{"producto_id":"<uuid>","cantidad":1}]'::jsonb);
--      select stock, tiktok_stock from public.products where id = '<uuid>';
--      select canal, origen, stock_anterior, stock_nuevo, lote
--        from public.stock_log where producto_id = '<uuid>'
--       order by creado_en desc limit 3;
--    rollback;
--
--    Lo que debe verse:
--      · delegada  → baja `stock`, renglón con canal 'tiktok_shop'
--      · mixta     → baja `tiktok_stock` y `stock` QUEDA IDÉNTICO
--      · sin dato  → no cambia nada, almacen='sin_dato' y NINGÚN renglón nuevo
--
-- 2) Guardián permanente. Debe dar 0 siempre; si algún día no, es que una venta
--    de TikTok tocó bodega:
--
--    select count(*) from public.stock_log l
--      join public.products p on p.id = l.producto_id
--     where l.origen in ('venta_tiktok','cancelacion_tiktok')
--       and (p.tiendanube_variant_id is not null or p.meli_item_id is not null)
--       and l.stock_nuevo is distinct from p.tiktok_stock;
--
-- 3) Que las RPC ya no sean públicas:
--
--    select p.proname, p.proacl from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in ('descontar_stock_tiktok','descontar_stock_ventas');
--    -- no debe aparecer ni =X/ (public) ni authenticated=X/
-- ============================================================================
