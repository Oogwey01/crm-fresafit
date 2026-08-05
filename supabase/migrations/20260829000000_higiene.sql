-- ============================================================================
-- 20260829000000_higiene.sql — Seis deudas chicas de la base, de una vez
-- ----------------------------------------------------------------------------
-- Ninguna da para migración propia y todas comparten la misma forma: son cosas
-- que ya están mal HOY y que no se notan porque fallan calladas. Un CHECK que
-- rechaza un renglón de bitácora, un default que arranca el flujo un paso más
-- adelante, un permiso que sobra. Nada de esto revienta una pantalla, y por eso
-- llevan meses ahí.
--
-- 1. `stock_log.canal` NO admite 'tiktok_shop'. El ledger nació en julio con
--    tres valores —crm, tienda_nube, mercado_libre— y TikTok llegó después.
--    Mientras tanto el código ya lo da por hecho: `lib/inventario/stock-log.ts`
--    declara el canal en su tipo y `lib/inventario/stock-hub.ts` traduce el
--    empuje a TikTok como 'tiktok_shop' antes de anotarlo. Ese insert lo rechaza
--    la base, y como `registrarStockLog` está escrito para no frenar nunca el
--    negocio, el error muere en un `console.error`. O sea: el día que el CRM
--    vuelva a escribirle a TikTok, la única pieza que no se enteraría es
--    justamente la que existe para que no se repita lo del 18/07. Se añade el
--    valor; no se quita ninguno.
--
-- 2. `personalizados.estado` nace en 'diseno'. La tabla se creó el 21/08 con ese
--    default, y al día siguiente `20260822000100_personalizados_hoja.sql` puso
--    los estados reales de la hoja —recibido → diseño → Eduardo → producción →
--    listo → enviado— pero no tocó el default. Resultado: un personalizado que
--    se da de alta sin decir su estado nace en el SEGUNDO paso, con el acuse de
--    recibido ya dado por hecho.
--
-- 3. `notifications` es la única tabla del esquema con permisos para `anon`
--    (`grant all … to anon` en 20260728000000_tareas_org_notificaciones.sql:41),
--    frente a las otras 58 que solo se los dan a `authenticated` y
--    `service_role`. Y no es un caso aislado sino el resto de algo más viejo:
--    `20250101000001_rls.sql:16` y `20250102000003_rls.sql:14` hicieron
--    `grant all on all tables in schema public to anon, authenticated` cuando el
--    esquema era otro, así que TODA tabla anterior a esa línea sigue con el
--    permiso puesto. Hoy no se explota —no hay una sola policy `to anon` en
--    `public`, así que RLS le devuelve cero filas a quien llegue con la llave
--    anónima—, pero el permiso sobra y depender de una sola capa para algo así
--    es apostar a que ninguna tabla futura nazca sin RLS. Se quita el caso
--    concreto y se pasa un barrido por si acaso.
--
--    Del barrido se excluye a propósito el SELECT, y solo el SELECT: es el que
--    de verdad tapa RLS, y quitarlo a ciegas podría romper algo que hoy dependa
--    de él sin que se sepa. Todo lo demás se va, y merece nombrarse por qué:
--      * TRUNCATE es la excepción a «RLS ya lo tapa», porque TRUNCATE NO pasa
--        por las policies. Una tabla con RLS y sin políticas está blindada
--        contra un `delete from`… y completamente indefensa ante un `truncate`.
--      * TRIGGER permitiría colgar de una tabla una función `security definer`
--        que ya exista. Por PostgREST no se llega —no admite DDL, y `anon` es
--        `nologin`—, pero es un permiso que no pinta nada ahí.
--      * REFERENCES es inofensivo; se va por no dejar la lista a medias.
--    Las secuencias se dejan como están: sin INSERT en ninguna tabla, poder
--    pedir un `nextval` no lleva a ningún lado.
--
-- 4. `stock_locks` le da `grant all` a `authenticated`
--    (20260725000000_escritura_segura.sql:43) y confía solo en RLS, que ahí está
--    activo y con CERO políticas. Su tabla hermana, `integraciones` —donde viven
--    los tokens de Tienda Nube—, sí hace el `revoke`. Antes de igualarlas se
--    revisó `app/` y `lib/` de punta a punta: nadie nombra la tabla. El único
--    consumidor es `lib/inventario/stock-hub.ts`, y llama a
--    `tomar_candado_stock` / `liberar_candado_stock`, que son SECURITY DEFINER y
--    por tanto no dependen del permiso de quien las invoca. El revoke no le
--    quita nada a nadie.
--
-- 5. `proteger_columnas_profiles` (20250101000002_hardening.sql:20) es el
--    trigger que impide que un miembro se auto-promueva a dirección con un PATCH
--    a su propia fila. Se apoya en `current_user in ('service_role','postgres',
--    'supabase_admin')`, el mismo patrón que en `restringir_update_tarea` resultó
--    ser un agujero y que `20260817000000_tareas_coasignados.sql` documentó y
--    corrigió.
--
--    Aquí NO es el mismo bug, y conviene decirlo con precisión: aquella función
--    venía marcada `security definer`, y dentro de una función así `current_user`
--    es el DUEÑO (postgres), nunca el rol de la petición — su primera guarda se
--    cumplía siempre. Esta no lleva `security definer`: es SECURITY INVOKER, así
--    que `current_user` sí vale 'authenticated' en una petición de PostgREST y la
--    guarda hace su trabajo. Hoy el candado cierra.
--
--    Lo que no cierra es el futuro. Un trigger hereda el contexto de QUIEN LO
--    DISPARA: basta con que mañana alguien escriba una RPC `security definer` que
--    haga `update public.profiles` —darse de alta en un equipo, cambiar de área
--    desde una pantalla— para que `current_user` pase a ser postgres mientras el
--    usuario detrás sigue siendo un miembro cualquiera, y el trigger se abra sin
--    que nadie toque este archivo. Es exactamente el accidente de 20260817,
--    esperando a ocurrir. (Comprobado: hoy ninguna función del esquema escribe en
--    `profiles`, y `app/`+`lib/` solo la leen. El riesgo es prospectivo.)
--
--    Así que se recrea la guarda para que no dependa de `current_user`, sino de
--    QUIÉN HIZO LA PETICIÓN, que es lo que en realidad se quiere saber y lo único
--    que no cambia al anidarse:
--      * el rol del JWT (`request.jwt.claims`), que PostgREST fija por petición y
--        que ninguna función puede suplantar → distingue service_role de verdad;
--      * `auth.uid()`, que dice si detrás hay una persona;
--      * `session_user`, que SECURITY DEFINER tampoco altera (solo cambia
--        `current_user`) → deja pasar el SQL Editor y psql, donde quien manda ya
--        tiene la llave de la casa.
--    La conducta observable no cambia: seeds, dashboard y dirección siguen
--    pudiendo cambiar rol y área; el resto sigue conservándolos.
--
-- 6. `zz_respaldo_policies_20260824` se borra. Es la foto de `pg_policies` que
--    tomó la migración de InitPlan para poder comparar y revertir a mano.
--
-- LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO. En el CRM conviven cuatro
-- vocabularios distintos de `canal` y ninguno es el mismo:
--
--   sales / sale_orders / customers / personalizados
--                       → tienda_nube, mercado_libre, tiktok_shop, punto_fisico,
--                         otro   (de dónde vino la VENTA)
--   stock_log           → crm, tienda_nube, mercado_libre (+ tiktok_shop aquí)
--                         (dónde impactó una ESCRITURA de stock; 'crm' no es un
--                         canal de venta y nunca podrá serlo)
--   recepciones_bodega  → tienda_nube, mercado_libre
--                         (a qué bodega entra la mercancía)
--
-- Unificarlos suena a limpieza y es lo contrario: significaría tocar CHECKs de
-- cuatro tablas con datos vivos —cada `add constraint` valida la tabla entera y
-- la bloquea mientras lo hace— para acabar con listas que admiten valores sin
-- sentido en su columna ('crm' como canal de venta, 'punto_fisico' como bodega).
-- No hay ganancia de rendimiento: un CHECK no se consulta, se evalúa al
-- escribir. Queda anotado como deuda conocida y sin plan de pago.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase, y las veces
-- que haga falta.
-- ============================================================================

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. stock_log.canal admite TikTok Shop.
--    El nombre del constraint se busca en el catálogo en vez de escribirlo: la
--    columna se creó con un `check` en línea, así que el nombre lo puso Postgres
--    (`stock_log_canal_check`), y como aquí las migraciones se pegan a mano el
--    archivo no es la fuente de verdad de lo que hay aplicado.
--
--    Antes de tocar nada se cuenta lo que NO cabría en la lista nueva. No
--    debería haber ni una fila —añadir un valor solo AFLOJA la restricción, así
--    que todo lo que pasaba el CHECK viejo pasa el nuevo—, y si aparece algo es
--    señal de que el constraint no está puesto en producción. En ese caso se
--    avisa y se deja la tabla como está: el `add constraint` fallaría de todas
--    formas, y aquí abortaría de paso los otros cinco arreglos.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fuera   bigint;
  v_valores text;
  v_nombre  text;
  v_quitados int := 0;
begin
  select count(*), string_agg(distinct canal, ', ')
    into v_fuera, v_valores
    from public.stock_log
   where canal not in ('crm','tienda_nube','mercado_libre','tiktok_shop');

  if v_fuera > 0 then
    raise notice 'ATENCIÓN: % filas de stock_log con un canal fuera de la lista (%). No se toca el CHECK: hay que decidir primero qué hacer con ellas.',
      v_fuera, v_valores;
    return;
  end if;

  for v_nombre in
    select c.conname
      from pg_constraint c
      join pg_attribute  a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.conrelid = 'public.stock_log'::regclass
       and c.contype  = 'c'
       and a.attname  = 'canal'
  loop
    execute format('alter table public.stock_log drop constraint %I', v_nombre);
    v_quitados := v_quitados + 1;
    raise notice 'stock_log: retirado el CHECK anterior (%)', v_nombre;
  end loop;

  alter table public.stock_log
    add constraint stock_log_canal_check
    check (canal in ('crm','tienda_nube','mercado_libre','tiktok_shop'));

  raise notice '[1] stock_log.canal: % CHECK reemplazado(s), ahora admite tiktok_shop', v_quitados;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Un personalizado nuevo entra por «recibido», que es donde empieza la hoja.
-- ---------------------------------------------------------------------------
alter table public.personalizados alter column estado set default 'recibido';

-- ---------------------------------------------------------------------------
-- 3. `anon` no escribe en ninguna tabla de `public`.
--    Primero el caso concreto (que es el único `grant` explícito a anon del
--    repo) y después el barrido, que alcanza a todo lo que arrastra el
--    `grant all … to anon` de las dos migraciones de 2025.
-- ---------------------------------------------------------------------------
revoke all on public.notifications from anon;

-- Todo salvo el SELECT (ver la cabecera: TRUNCATE no lo filtra RLS).
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- 4. El candado de stock es maquinaria interna: se toca por sus RPC o no se
--    toca. Las funciones son SECURITY DEFINER y conservan su `grant execute`,
--    así que el hub sigue funcionando igual.
-- ---------------------------------------------------------------------------
revoke all on public.stock_locks from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. La guarda de `profiles`, sin depender de `current_user`.
--    Sigue SIN `security definer` (no lo necesita: solo llama a `es_admin`, que
--    sí lo es). Se le añade `set search_path = public`, que es lo que ya llevan
--    las funciones nuevas del esquema.
-- ---------------------------------------------------------------------------
create or replace function public.proteger_columnas_profiles()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- El rol de la PETICIÓN, leído del JWT tal como lo deja PostgREST. Es lo mismo
  -- que mira `auth.role()`, escrito a mano para no depender de un helper que
  -- Supabase da por obsoleto. Vacío = no viene de la API (SQL Editor, psql, cron
  -- por conexión directa).
  v_rol text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims',     true), '')::jsonb ->> 'role',
    '');
begin
  -- Procesos sin persona detrás: los scripts de seed y de alta con la llave de
  -- servicio, y las sesiones de base de datos directas. Ninguno de los dos trae
  -- un usuario final, y esa es justo la condición que hay que exigir.
  if v_rol = 'service_role'
     or (auth.uid() is null and session_user in ('postgres','supabase_admin'))
  then
    return new;
  end if;

  -- Dirección: puede cambiarle el rol y el área a quien sea.
  if public.es_admin(auth.uid()) then
    return new;
  end if;

  -- Todos los demás: se conservan rol y área; el resto (nombre, color) sí cambia.
  new.rol  := old.rol;
  new.area := old.area;
  return new;
end;
$$;

-- El trigger no cambia; se recrea por si la migración vieja no llegó a correr.
drop trigger if exists profiles_proteger_columnas on public.profiles;
create trigger profiles_proteger_columnas
  before update on public.profiles
  for each row execute function public.proteger_columnas_profiles();

-- ---------------------------------------------------------------------------
-- 6. La foto de respaldo de las policies.
--    CORRER ESTO SOLO DESPUÉS de haber validado 20260824000000_rls_initplan.sql
--    con las tres consultas de su pie (que no falte ninguna política, que
--    ninguna cambió de comando ni de roles, y que el InitPlan aparezca en el
--    plan de ejecución). Mientras esas comprobaciones no estén hechas, esta
--    tabla es la única manera de saber cómo estaban las cosas antes: si hay
--    dudas, comentar la línea y volver a ella otro día.
-- ---------------------------------------------------------------------------
drop table if exists public.zz_respaldo_policies_20260824;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
-- 1) El CHECK de stock_log ya nombra a TikTok:
--
--    select conname, pg_get_constraintdef(oid)
--      from pg_constraint
--     where conrelid = 'public.stock_log'::regclass and contype = 'c';
--
--    Y que de verdad entre (rollback al final: es un ledger, no se ensucia):
--
--    begin;
--      insert into public.stock_log (producto_id, canal, origen, stock_nuevo)
--        values (null, 'tiktok_shop', 'prueba', 0);
--    rollback;
--
-- 2) El default de personalizados:
--
--    select column_default from information_schema.columns
--     where table_schema = 'public' and table_name = 'personalizados'
--       and column_name = 'estado';        -- debe decir 'recibido'::text
--
-- 3) Que a `anon` no le quede escritura en ninguna tabla (0 filas), y de paso
--    qué tablas conserva en SELECT (eso es lo esperado):
--
--    select table_name, privilege_type
--      from information_schema.role_table_grants
--     where grantee = 'anon' and table_schema = 'public'
--       and privilege_type <> 'SELECT'
--     order by table_name, privilege_type;
--
-- 4) Que `stock_locks` no le quede a nadie salvo al dueño (0 filas para anon y
--    authenticated), y que el candado siga tomándose por su RPC:
--
--    select grantee, privilege_type from information_schema.role_table_grants
--     where table_schema = 'public' and table_name = 'stock_locks';
--
--    select public.tomar_candado_stock((select id from public.products limit 1), 5);
--    select public.liberar_candado_stock((select id from public.products limit 1));
--
-- 5) La prueba que importa del punto 5, con una sesión REAL de alguien que no
--    sea dirección (desde el CRM, en la consola del navegador):
--
--      await supabase.from('profiles')
--        .update({ rol: 'direccion' })
--        .eq('id', (await supabase.auth.getUser()).data.user.id)
--
--    Debe responder sin error —el trigger no levanta excepción, congela las
--    columnas— y la fila debe seguir con el rol de antes. Comprobarlo:
--
--    select id, nombre, rol, area from public.profiles order by nombre;
--
-- 6) Que la tabla de respaldo ya no está:
--
--    select to_regclass('public.zz_respaldo_policies_20260824');   -- null
-- ============================================================================
