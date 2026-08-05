-- ============================================================================
-- 20260825000000_indices.sql
-- ----------------------------------------------------------------------------
-- Índices que faltaban. Son de tres clases, y conviene distinguirlas porque se
-- notan en momentos distintos:
--
-- 1) LLAVES FORÁNEAS SIN ÍNDICE. Postgres NO indexa una FK por el hecho de
--    serlo (a diferencia de MySQL): solo indexa la PK. Aquí eso pesa en dos
--    situaciones. La primera es al consultar «lo de este padre»: por ejemplo
--    `unidades_en_camino()` —la función que le dice a Inventario cuántas piezas
--    vienen en camino— agrupa por `supplier_order_items.producto_id`, que no
--    tenía índice. La segunda es al BORRAR el padre: cada `on delete cascade` o
--    `set null` obliga a recorrer la tabla hija entera. Borrar una tarea
--    escaneaba `notifications` completa; borrar un producto escaneaba cuatro
--    tablas de bodega.
--
-- 2) `created_by` / `autor`, que están en una veintena de tablas apuntando a
--    `profiles` con `on delete set null` y ninguna indexada. Dar de baja a un
--    miembro del equipo dispara ese mismo recorrido en las veinte a la vez. En
--    vez de listarlas a mano se recorre el catálogo, así que si mañana aparece
--    una tabla nueva con `created_by` esta migración la cubre al repetirse.
--
-- 3) COMPUESTOS Y PARCIALES para lo que las pantallas piden de verdad. Hoy hay
--    índices sueltos por `fecha` y por `canal`, pero Métricas pide siempre las
--    dos cosas juntas y además ordena por `fecha desc, created_at desc`: con
--    índices separados Postgres usa uno y ordena el resto a mano. El parcial de
--    ventas no canceladas es el caso más marcado, porque ese filtro va en casi
--    todas las consultas de venta del CRM.
--
-- Nada de esto cambia resultados: un índice solo cambia por dónde llega
-- Postgres a las mismas filas. Lo único que se altera de verdad es el nombre de
-- un índice de `personalizados` (ver el punto 4, al final).
--
-- ⚠️ PEGAR UN BLOQUE A LA VEZ, ESPERANDO A QUE CADA UNO TERMINE.
--
-- No es una manía. El editor SQL corre TODO lo que se le pega en una sola
-- transacción, y `create index` toma un candado sobre su tabla que no suelta
-- hasta el commit. Pegar el archivo entero significa acabar reteniendo a la vez
-- un candado sobre las cuarenta tablas que toca, mientras la aplicación sigue
-- escribiendo; y como esta migración indexa `notifications` antes que `tasks`
-- mientras el trigger de asignación de tareas las escribe en el orden
-- contrario, hay un ciclo posible. Eso es un deadlock: Postgres mata a uno de
-- los dos, y si le toca a la aplicación, se cae una operación de un usuario.
--
-- Es la misma lección que ya está escrita en 20260822000100_personalizados_hoja
-- («tocar tres tablas de golpe deadlockeó contra la app en producción»), y
-- `set lock_timeout` no la cubre: ese ajuste limita cuánto se ESPERA por un
-- candado, no cuánto se retiene, y el detector de deadlocks salta antes.
--
-- Los tres bloques están separados por una línea de guiones bien visible.
-- Pegándolos de uno en uno, cada transacción dura un instante y toca pocas
-- tablas. Mejor aún en hora valle. Si alguno aborta por `lock_timeout`, no pasa
-- nada: se vuelve a pegar ese bloque y ya.
--
-- Se crean SIN `concurrently` porque no cabe dentro de un bloque transaccional
-- ni dentro de un `DO`, y las tablas son chicas (segundos).
--
-- Idempotente: cada bloque se puede pegar las veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Llaves foráneas sin índice.
--    Antes de crear cada uno se comprueba que la columna exista y que no haya
--    ya otro índice que la lleve de primera (uno compuesto `(col, algo)` sirve
--    igual para buscar por `col`, así que crear otro sería peso muerto).
-- ---------------------------------------------------------------------------
do $$
declare
  d       record;
  creados int := 0;
  omitidos int := 0;
begin
  for d in
    select * from (values
      -- Inventario y proveedores
      ('supplier_order_items',  'producto_id'),          -- lo agrupa unidades_en_camino()
      ('supplier_orders',       'proveedor_id'),         -- "pedidos de este proveedor"
      ('recepciones_bodega',    'pedido_proveedor_id'),
      ('recepcion_items',       'producto_id'),
      ('conjunto_componentes',  'producto_id'),
      ('envio_full_items',      'producto_id'),
      ('influencer_entregas',   'producto_id'),
      -- Tareas y avisos
      ('notifications',         'task_id'),              -- borrar una tarea la escaneaba entera
      -- Ventas
      ('sale_orders',           'cliente_id'),           -- sales.cliente_id sí lo tenía
      -- Agencia y nómina
      ('agencia_ingresos',      'contrato_id'),
      ('agencia_asignaciones',  'profile_id'),
      ('nomina_empleados',      'profile_id')
    ) as t(tabla, col)
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = d.tabla and column_name = d.col
    ) then
      raise notice 'omitido: no existe public.%.%', d.tabla, d.col;
      omitidos := omitidos + 1;
      continue;
    end if;

    if exists (
      select 1
        from pg_index i
        join pg_attribute a
          on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
       where i.indrelid = format('public.%I', d.tabla)::regclass
         and a.attname  = d.col
    ) then
      raise notice 'omitido: %.% ya va de primera en otro índice', d.tabla, d.col;
      omitidos := omitidos + 1;
      continue;
    end if;

    execute format('create index if not exists %I on public.%I (%I)',
                   d.tabla || '_' || d.col || '_idx', d.tabla, d.col);
    raise notice 'creado %_%_idx', d.tabla, d.col;
    creados := creados + 1;
  end loop;

  raise notice '[1] FKs: % creados, % omitidos', creados, omitidos;
end
$$;


-- ▼▼▼ FIN DEL BLOQUE — pega hasta aquí, espera, y sigue con el siguiente ▼▼▼
-- ══════════════════════════════════════════════════════════════════════════

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 2. Todo lo que apunta a `profiles` (created_by, autor, responsable_id…).
--    Se saca del catálogo en vez de listarlo: son ~20 tablas y crecen.
-- ---------------------------------------------------------------------------
do $$
declare
  d       record;
  nombre  text;
  creados int := 0;
begin
  for d in
    select cl.relname as tabla, a.attname as col
      from pg_constraint c
      join pg_class     cl on cl.oid = c.conrelid
      join pg_attribute a  on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and c.confrelid = 'public.profiles'::regclass
       and array_length(c.conkey, 1) = 1
       -- solo si no hay ya un índice que lleve esa columna de primera
       and not exists (
         select 1
           from pg_index i
           join pg_attribute ia on ia.attrelid = i.indrelid and ia.attnum = i.indkey[0]
          where i.indrelid = c.conrelid and ia.attname = a.attname
       )
     order by cl.relname, a.attname
  loop
    nombre := d.tabla || '_' || d.col || '_idx';
    execute format('create index if not exists %I on public.%I (%I)', nombre, d.tabla, d.col);
    raise notice 'creado % (→ profiles)', nombre;
    creados := creados + 1;
  end loop;

  raise notice '[2] Referencias a profiles: % índices creados', creados;
end
$$;


-- ▼▼▼ FIN DEL BLOQUE — pega hasta aquí, espera, y sigue con el siguiente ▼▼▼
-- ══════════════════════════════════════════════════════════════════════════

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 3. Compuestos y parciales, según lo que piden las pantallas.
--    Igual que arriba, cada uno se salta si le falta alguna columna.
-- ---------------------------------------------------------------------------
do $$
declare
  d       record;
  creados int := 0;
begin
  for d in
    select * from (values
      -- Métricas y Reportes: ventas vivas del periodo, en el orden que se pintan.
      ('sales_activas_fecha_idx', 'sales', '(fecha desc, created_at desc)',
       'where (estado is null or estado <> ''cancelado'')', 'fecha,created_at,estado'),
      -- Página de canal (ML, TikTok, TN): un canal dentro de un rango de fechas.
      ('sales_canal_fecha_idx', 'sales', '(canal, fecha desc)', '', 'canal,fecha'),
      ('sale_orders_canal_fecha_idx', 'sale_orders', '(canal, fecha desc)', '', 'canal,fecha'),
      -- Cuadre de órdenes: se filtra por estado para excluir canceladas.
      ('sale_orders_estado_idx', 'sale_orders', '(estado)', '', 'estado'),
      -- Finanzas: gastos del periodo con el mismo orden de la tabla.
      ('expenses_fecha_creado_idx', 'expenses', '(fecha desc, created_at desc)', '', 'fecha,created_at'),
      -- Bodega: los últimos 200 movimientos de TODOS los insumos (el índice que
      -- había es por insumo, y esta vista no filtra por insumo).
      ('insumo_mov_creado_idx', 'insumo_movimientos', '(created_at desc)', '', 'created_at')
    ) as t(nombre, tabla, cols, filtro, requiere)
  loop
    if exists (
      select 1 from unnest(string_to_array(d.requiere, ',')) as c(col)
       where not exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = d.tabla and column_name = c.col
       )
    ) then
      raise notice 'omitido %: le falta alguna columna en %', d.nombre, d.tabla;
      continue;
    end if;

    if exists (select 1 from pg_indexes
                where schemaname = 'public' and indexname = d.nombre) then
      raise notice 'omitido %: ya existe', d.nombre;
      continue;
    end if;

    execute format('create index if not exists %I on public.%I %s %s',
                   d.nombre, d.tabla, d.cols, d.filtro);
    raise notice 'creado %', d.nombre;
    creados := creados + 1;
  end loop;

  raise notice '[3] Compuestos y parciales: % creados', creados;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Un nombre que mentía.
--    `20260821000000_bodega.sql` creó `personalizados_estado_idx` sobre
--    (estado, fecha_compra desc). Al día siguiente `20260822000100` intentó
--    crear un índice del MISMO nombre sobre (estado) a secas: como llevaba
--    `if not exists`, no hizo nada y nadie se enteró. El índice que existe es
--    el compuesto —que sirve igual para buscar solo por estado, porque `estado`
--    va de primera—, así que no falta ningún índice: solo hay que ponerle el
--    nombre que le corresponde.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_indexes
              where schemaname = 'public' and indexname = 'personalizados_estado_idx')
     and not exists (select 1 from pg_indexes
              where schemaname = 'public' and indexname = 'personalizados_estado_fecha_idx')
  then
    alter index public.personalizados_estado_idx rename to personalizados_estado_fecha_idx;
    raise notice 'renombrado personalizados_estado_idx → personalizados_estado_fecha_idx';
  else
    raise notice 'personalizados: nada que renombrar';
  end if;
end
$$;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
-- 1) Los índices nuevos, y de paso el peso que ocupan:
--
--    select tablename, indexname, pg_size_pretty(pg_relation_size(indexname::regclass)) as tamano
--      from pg_indexes
--     where schemaname = 'public'
--       and (indexname like '%\_producto\_id\_idx' or indexname like '%\_profile\_id\_idx'
--            or indexname like '%\_created\_by\_idx' or indexname in (
--              'sales_activas_fecha_idx','sales_canal_fecha_idx','sale_orders_canal_fecha_idx',
--              'sale_orders_estado_idx','expenses_fecha_creado_idx','insumo_mov_creado_idx',
--              'notifications_task_id_idx','supplier_orders_proveedor_id_idx',
--              'supplier_order_items_producto_id_idx','personalizados_estado_fecha_idx'))
--     order by tablename, indexname;
--
-- 2) Que «Qué pedir» ya no recorra los renglones de pedido enteros. Debe
--    aparecer un Index Scan / Bitmap sobre supplier_order_items_producto_id_idx:
--
--    explain (analyze, timing off) select * from public.unidades_en_camino();
--
-- 3) Pasados unos días, cuáles se están usando de verdad (idx_scan > 0):
--
--    select relname as tabla, indexrelname as indice, idx_scan as usos
--      from pg_stat_user_indexes
--     where schemaname = 'public'
--     order by idx_scan asc, relname;
-- ============================================================================
