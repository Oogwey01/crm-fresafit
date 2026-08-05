-- ============================================================================
-- 20260830000000_retencion_logs.sql — Las bitácoras dejan de crecer para siempre
-- ----------------------------------------------------------------------------
-- Cuatro tablas del CRM solo saben crecer. `stock_log` anota cada escritura de
-- inventario; `stock_canal_log` anota cada diferencia que la foto horaria
-- encuentra entre el CRM y los canales; `task_activity` anota cada movimiento de
-- cada tarea; `notifications` anota cada aviso de la campana. Ninguna se limpia
-- nunca, porque nadie escribió el borrado: no es una decisión que se tomara, es
-- una que no se tomó.
--
-- Y son justo las tablas donde el dato caduca solo. Un movimiento de stock sirve
-- para explicar un descuadre de esta semana o del mes pasado; el de febrero no
-- lo va a abrir nadie. Un aviso de campana ya leído hace tres meses no es
-- historia, es basura con fecha. Se conservan 90 días, que es lo acordado y lo
-- que de verdad se consulta.
--
-- SE BORRA POR TABLA, CON UN CRITERIO POR TABLA:
--   stock_log       → `creado_en` (el ledger de escrituras del CRM)
--   stock_canal_log → `detectado_en` (los cambios que ve la foto horaria)
--   task_activity   → `created_at` (el historial de cada tarea)
--   notifications   → `created_at` Y SOLO LAS LEÍDAS. Un aviso sin leer se
--                     queda aunque tenga un año: que alguien lleve meses sin
--                     abrir la campana no es motivo para borrarle lo que le
--                     mandaron. Además `push_enviado_at` vive en esa misma fila,
--                     así que borrar un aviso pendiente sería además perder el
--                     rastro de si el push llegó a salir.
--
-- LA PRIMERA PASADA ES UN ENSAYO, y por eso el parámetro se llama al revés de lo
-- que uno esperaría: `solo_contar` viene en `true` por defecto. Llamarla a secas
-- —`select public.purgar_logs();`— NO BORRA NADA: cuenta cuántas filas caerían y
-- devuelve el desglose. Hay que pedir el borrado a propósito, con
-- `purgar_logs(false)`. Un borrado masivo irreversible no debe ser lo que pasa
-- cuando alguien se equivoca de paréntesis.
--
-- SOBRE BORRAR «POR LOTES». Partir el borrado en tandas dentro de esta función
-- sería teatro: una función de plpgsql corre entera dentro de UNA transacción,
-- así que los candados de fila se sueltan al terminar tanto si se borra de un
-- golpe como si se hacen veinte vueltas. Lo único que se gana partiendo es que
-- otra sesión pueda colarse en medio, y eso requiere transacciones separadas —o
-- sea, llamar varias veces desde fuera—. Lo que sí sirve, y es lo que se hace,
-- es un TOPE por tabla y por llamada: la corrida no puede pasarse de ahí, y si
-- lo alcanza lo dice en el resultado (`quedan_pendientes`) para que se vuelva a
-- llamar. Así el primer barrido —el que arrastra el atraso de un año entero— no
-- se convierte en una transacción de varios minutos con media base bloqueada,
-- mientras que las corridas de rutina, que borran unos pocos días, caben de
-- sobra en una sola llamada.
--
-- El conteo, en cambio, NUNCA se topa: el ensayo tiene que decir la magnitud
-- real, no la del tope.
--
-- SOBRE LO QUE VA A COSTAR LA PRIMERA VEZ. `stock_log` y `stock_canal_log`
-- tienen índice por fecha y llegan directas a lo viejo. `task_activity` y
-- `notifications` no lo tienen —sus índices van por tarea y por usuario—, así
-- que su primer barrido las recorre enteras. No se les añade índice: son
-- recorridos de tablas chicas, y un índice que solo usaría la purga se pagaría
-- en cada insert de cada tarea para ahorrar unos milisegundos una vez por
-- semana. Aun así, mejor pegar esto en hora valle.
--
-- QUIÉN PUEDE EJECUTARLA: el cron (service_role) y dirección. Es SECURITY
-- DEFINER porque tiene que borrar de tablas que a propósito NO tienen policy de
-- delete —`stock_log` es un ledger append-only y así debe seguir para todo el
-- mundo—, y precisamente por eso la guarda NO se apoya en `current_user`: dentro
-- de una función `security definer` ese valor es el DUEÑO de la función, nunca
-- el rol de quien llama, que es el bug que documentó
-- `20260817000000_tareas_coasignados.sql`. Se mira el rol del JWT, que PostgREST
-- fija por petición y que ninguna función puede suplantar.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta. Crear la
-- función no borra nada; el borrado es una llamada aparte.
-- ============================================================================

set lock_timeout = '10s';

create or replace function public.purgar_logs(solo_contar boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Los 90 días acordados, y el techo de filas por tabla y por llamada.
  c_dias  constant int := 90;
  c_tope  constant int := 50000;

  -- El rol de la PETICIÓN, leído del JWT tal como lo deja PostgREST. Es lo que
  -- mira `auth.role()`, escrito a mano para no depender de un helper que
  -- Supabase da por obsoleto. Vacío = no viene de la API.
  v_rol text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims',     true), '')::jsonb ->> 'role',
    '');

  v_corte    timestamptz := now() - make_interval(days => c_dias);
  d          record;
  v_n        bigint;
  v_conteos  jsonb    := '{}'::jsonb;
  v_total    bigint   := 0;
  v_topadas  boolean  := false;
begin
  -- El cron, dirección, o una sesión de base de datos directa (SQL Editor y
  -- psql: quien llega por ahí ya tiene la llave de la casa). `session_user` no
  -- lo altera SECURITY DEFINER —solo cambia `current_user`—, así que sirve para
  -- distinguirlo.
  if not (
       v_rol = 'service_role'
       or public.es_admin(auth.uid())
       or (auth.uid() is null and session_user in ('postgres','supabase_admin'))
     )
  then
    raise exception 'Solo dirección o los procesos internos pueden purgar la bitácora.';
  end if;

  for d in
    select * from (values
      ('stock_log',       'creado_en',    ''),
      ('stock_canal_log', 'detectado_en', ''),
      ('task_activity',   'created_at',   ''),
      -- El único con condición extra: las no leídas se quedan.
      ('notifications',   'created_at',   ' and leida')
    ) as t(tabla, col, filtro)
  loop
    -- Estas migraciones se pegan a mano: puede faltar alguna tabla si el orden
    -- se rompió. Se salta con aviso en vez de tumbar el resto de la purga.
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = d.tabla and column_name = d.col
    ) then
      raise notice 'omitida public.%: no existe, o le falta la columna %', d.tabla, d.col;
      continue;
    end if;

    -- Cuántas caen. Siempre el total real, sin aplicar el tope.
    execute format('select count(*) from public.%I where %I < $1 %s',
                   d.tabla, d.col, d.filtro)
      into v_n using v_corte;

    if not solo_contar and v_n > 0 then
      -- Las más viejas primero: si el tope corta, lo que queda para la próxima
      -- llamada es siempre lo más reciente.
      execute format(
        'with viejos as (
           select id from public.%I where %I < $1 %s order by %I limit $2
         )
         delete from public.%I t using viejos v where t.id = v.id',
        d.tabla, d.col, d.filtro, d.col, d.tabla)
        using v_corte, c_tope;
      get diagnostics v_n = row_count;
      if v_n >= c_tope then
        v_topadas := true;
      end if;
    end if;

    v_conteos := v_conteos || jsonb_build_object(d.tabla, v_n);
    v_total   := v_total + v_n;
    raise notice '% : % filas%', d.tabla, v_n,
      case when solo_contar then ' (ensayo, no se borró nada)' else ' borradas' end;
  end loop;

  return jsonb_build_object(
    'ensayo',            solo_contar,
    'dias_conservados',  c_dias,
    'corte',             v_corte,
    'tablas',            v_conteos,
    'total',             v_total,
    'tope_por_tabla',    c_tope,
    'quedan_pendientes', v_topadas
  );
end;
$$;

comment on function public.purgar_logs(boolean) is
  'Purga las bitácoras de más de 90 días (stock_log, stock_canal_log, task_activity y las notificaciones YA LEÍDAS). Por defecto solo cuenta: hay que pedir el borrado con purgar_logs(false). Devuelve el desglose por tabla.';

-- Ejecutarla no puede quedar en manos de PUBLIC, que es a quien Postgres se la
-- da por omisión al crearla: es una función que borra.
revoke all on function public.purgar_logs(boolean) from public, anon;
grant execute on function public.purgar_logs(boolean) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
-- 1) EL ENSAYO. Esto es lo primero y no borra nada:
--
--    select jsonb_pretty(public.purgar_logs());
--
--    Leer los conteos antes de seguir. Si alguno sale desproporcionado respecto
--    al tamaño de su tabla, entenderlo ANTES de correr el borrado real:
--
--    select 'stock_log' as tabla, count(*) as filas, min(creado_en) as mas_vieja
--      from public.stock_log
--    union all select 'stock_canal_log', count(*), min(detectado_en) from public.stock_canal_log
--    union all select 'task_activity',   count(*), min(created_at)   from public.task_activity
--    union all select 'notifications',   count(*), min(created_at)   from public.notifications;
--
-- 2) EL BORRADO REAL. Solo cuando el ensayo cuadre:
--
--    select jsonb_pretty(public.purgar_logs(false));
--
--    Si `quedan_pendientes` sale en true, alguna tabla alcanzó el tope de 50.000:
--    repetir la llamada hasta que salga false. Después conviene un
--    `vacuum (analyze) public.stock_log;` (y las demás) para que el espacio se
--    reutilice y las estadísticas se enteren.
--
-- 3) Que la guarda cierre. Desde el CRM con una sesión que NO sea de dirección
--    (consola del navegador), esto debe responder con el error de permiso y no
--    con un conteo:
--
--      await supabase.rpc('purgar_logs')
--
-- 4) La ruta de cron, con el CRON_SECRET del proyecto:
--
--    curl -s -H "Authorization: Bearer $CRON_SECRET" \
--         "https://crm-fresafit-six.vercel.app/api/cron/purga?ensayo=1"
--
--    Con `?ensayo=1` cuenta; sin el parámetro, borra.
-- ============================================================================
