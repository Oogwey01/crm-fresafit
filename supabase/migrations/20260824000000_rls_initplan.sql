-- ============================================================================
-- 20260824000000_rls_initplan.sql
-- ----------------------------------------------------------------------------
-- Las 127 políticas de RLS llaman a `auth.uid()` y a los helpers de rol
-- (`es_interno()`, `es_gestor()`, …) en su forma desnuda. Postgres, cuando una
-- función aparece así dentro de un `using`, la considera parte del filtro de
-- fila y la EJECUTA UNA VEZ POR CADA FILA examinada. En una tabla de 20 filas da
-- igual; en `sales` —que Métricas recorre de a 5.000 y Reportes vuelve a
-- recorrer— son 5.000 lecturas a `profiles` para resolver 5.000 veces la misma
-- pregunta: «¿quién soy y qué rol tengo?». Lo mismo en `products`, que el CRM
-- pagina entero en cinco pantallas distintas.
--
-- Envolver la llamada en un subselect —`(select auth.uid())`— la convierte en
-- un InitPlan: Postgres la resuelve UNA sola vez antes de empezar a escanear y
-- reutiliza el valor para todas las filas. Mismo resultado, misma seguridad;
-- solo cambia cuántas veces se pregunta. Es la recomendación explícita de
-- Supabase para RLS y es, con diferencia, el arreglo más barato de todo el CRM.
--
-- POR QUÉ SE HACE RECORRIENDO `pg_policies` Y NO REESCRIBIENDO A MANO:
-- las políticas de este esquema se pisan unas a otras a lo largo de 30
-- migraciones (`20260819` reemplaza las de `20260715`, `20260823` reemplaza las
-- de `20250103`…). Y como aquí las migraciones se pegan a mano en el SQL
-- Editor, el archivo NO es la fuente de verdad de lo que hay aplicado: la
-- única fuente de verdad es el catálogo. Así que se lee de ahí, se recrea cada
-- política tal cual está —mismo nombre, mismo comando, mismos roles, misma
-- expresión— con el único cambio del envoltorio, y se avisa por consola de
-- cada una.
--
-- QUÉ NO SE TOCA:
--   * `puede_ver_tarea(task_id)`, `puede_contribuir_tarea(task_id)` y
--     `es_asignado_tarea(id)` reciben una columna DE LA FILA: su resultado
--     cambia fila a fila, así que envolverlas no ahorraría nada (y sería
--     incorrecto). Se dejan como están.
--   * Las políticas de `storage.objects` (buckets de facturas, adjuntos y
--     fotos). Ahí el volumen por consulta es de decenas de objetos, no de
--     miles; el beneficio no compensa tocar un esquema que no es nuestro.
--
-- SEGURIDAD DE LA OPERACIÓN: el bloque entero corre en una sola transacción.
-- Si una sola política fallara al recrearse, se revierten TODAS y la base queda
-- exactamente como estaba — el peor caso posible es «no pasó nada». Además se
-- deja una copia consultable del estado previo en `zz_respaldo_policies_...`
-- para poder comparar; la Fase 7 de la limpieza la borra.
--
-- Idempotente: se puede pegar tal cual, y las veces que haga falta. Las
-- políticas ya envueltas se saltan (se avisa cuántas).
-- ============================================================================

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Foto del estado previo, por si hay que comparar o revertir a mano.
--    Lleva `revoke` + RLS sin políticas porque una migración vieja hizo
--    `grant all on all tables to anon, authenticated` y esta tabla nueva lo
--    heredaría: dentro van las reglas de acceso de todo el CRM.
-- ---------------------------------------------------------------------------
create table if not exists public.zz_respaldo_policies_20260824 as
  select * from pg_policies where schemaname = 'public';

revoke all on public.zz_respaldo_policies_20260824 from anon, authenticated;
alter table public.zz_respaldo_policies_20260824 enable row level security;

comment on table public.zz_respaldo_policies_20260824 is
  'Copia de pg_policies antes del cambio a InitPlan (20260824). Borrar tras validar.';

-- ---------------------------------------------------------------------------
-- 2. El cambio.
-- ---------------------------------------------------------------------------
do $$
declare
  p            record;
  q            text;
  c            text;
  sql          text;
  roles_txt    text;
  tocadas      int := 0;
  saltadas     int := 0;
  pendientes   int;
begin
  -- Sobre las sustituciones de más abajo: el orden importa, porque
  -- `es_admin(auth.uid())` lleva un `auth.uid()` dentro. Primero se aparta con
  -- una marca para que el paso siguiente no lo parta por la mitad, y al final
  -- se restituye ya envuelto entero. Los patrones aceptan el prefijo `public.`
  -- como opcional porque el catálogo decompila las expresiones cualificándolas
  -- o no según el search_path de la sesión, y no queremos depender de eso.
  for p in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~*
           '(auth\.uid\s*\(\s*\)|es_interno\s*\(\s*\)|es_gestor\s*\(\s*\)|es_administrativo\s*\(\s*\))'
     order by tablename, policyname
  loop
    -- Guarda de idempotencia: si la política YA trae alguna llamada envuelta,
    -- están todas (la sustitución de abajo es global sobre la política entera),
    -- así que no hay nada que hacer.
    if (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~*
       '\(\s*select\s+(public\.)?(auth\.uid|es_interno|es_gestor|es_administrativo|es_admin)' then
      saltadas := saltadas + 1;
      continue;
    end if;

    q := p.qual;
    c := p.with_check;

    if q is not null then
      q := regexp_replace(q, '(public\.)?es_admin\s*\(\s*auth\.uid\s*\(\s*\)\s*\)', '@@ESADMIN@@', 'gi');
      q := regexp_replace(q, 'auth\.uid\s*\(\s*\)',                  '(select auth.uid())', 'gi');
      q := regexp_replace(q, '(public\.)?es_interno\s*\(\s*\)',       '(select public.es_interno())', 'gi');
      q := regexp_replace(q, '(public\.)?es_gestor\s*\(\s*\)',        '(select public.es_gestor())', 'gi');
      q := regexp_replace(q, '(public\.)?es_administrativo\s*\(\s*\)','(select public.es_administrativo())', 'gi');
      q := replace(q, '@@ESADMIN@@', '(select public.es_admin(auth.uid()))');
    end if;

    if c is not null then
      c := regexp_replace(c, '(public\.)?es_admin\s*\(\s*auth\.uid\s*\(\s*\)\s*\)', '@@ESADMIN@@', 'gi');
      c := regexp_replace(c, 'auth\.uid\s*\(\s*\)',                  '(select auth.uid())', 'gi');
      c := regexp_replace(c, '(public\.)?es_interno\s*\(\s*\)',       '(select public.es_interno())', 'gi');
      c := regexp_replace(c, '(public\.)?es_gestor\s*\(\s*\)',        '(select public.es_gestor())', 'gi');
      c := regexp_replace(c, '(public\.)?es_administrativo\s*\(\s*\)','(select public.es_administrativo())', 'gi');
      c := replace(c, '@@ESADMIN@@', '(select public.es_admin(auth.uid()))');
    end if;

    select string_agg(quote_ident(r), ', ') into roles_txt from unnest(p.roles) as r;

    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);

    sql := format(
      'create policy %I on %I.%I as %s for %s to %s',
      p.policyname, p.schemaname, p.tablename,
      case when p.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
      p.cmd,
      roles_txt
    );
    -- INSERT solo admite `with check`; SELECT y DELETE solo `using`; ALL y
    -- UPDATE pueden traer las dos. El catálogo ya deja en null la que no aplica.
    if q is not null then sql := sql || format(' using (%s)', q); end if;
    if c is not null then sql := sql || format(' with check (%s)', c); end if;

    execute sql;
    tocadas := tocadas + 1;
    raise notice 'InitPlan → %.% : %', p.tablename, p.cmd, p.policyname;
  end loop;

  -- Recuento final. Para saber si queda algo suelto no basta con buscar
  -- `auth.uid()`: una llamada ya envuelta como `(select es_admin(auth.uid()))`
  -- sigue conteniendo el texto por dentro. Así que primero se BORRAN del texto
  -- las formas ya envueltas y se busca en lo que sobra.
  select count(*) into pendientes
    from pg_policies
   where schemaname = 'public'
     and regexp_replace(
           coalesce(qual, '') || ' ' || coalesce(with_check, ''),
           '\(\s*SELECT\s+(public\.)?(auth\.uid\(\)|es_admin\s*\(\s*auth\.uid\(\)\s*\)|es_interno\(\)|es_gestor\(\)|es_administrativo\(\))(\s+AS\s+\w+)?\s*\)',
           '', 'gi'
         ) ~* '(auth\.uid\s*\(|(^|[^_[:alnum:]])es_interno\s*\(|(^|[^_[:alnum:]])es_gestor\s*\(|(^|[^_[:alnum:]])es_administrativo\s*\()';

  raise notice '---';
  raise notice 'Políticas reescritas: %  |  ya estaban envueltas: %  |  quedan sueltas: %',
    tocadas, saltadas, pendientes;
  if pendientes > 0 then
    raise notice 'ATENCIÓN: deberían quedar 0. Ver cuáles con la consulta (1) del pie.';
  end if;
end
$$;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
-- 1) Que no quede ninguna llamada suelta. Debe devolver 0 filas. (Se borran del
--    texto las formas ya envueltas y se busca en lo que sobra: buscar
--    `auth.uid()` a secas daría falsos positivos, porque una llamada correcta
--    como `(select es_admin(auth.uid()))` lo lleva dentro.)
--
--    select tablename, policyname, cmd, qual, with_check
--      from pg_policies
--     where schemaname = 'public'
--       and regexp_replace(
--             coalesce(qual,'') || ' ' || coalesce(with_check,''),
--             '\(\s*SELECT\s+(public\.)?(auth\.uid\(\)|es_admin\s*\(\s*auth\.uid\(\)\s*\)|es_interno\(\)|es_gestor\(\)|es_administrativo\(\))(\s+AS\s+\w+)?\s*\)',
--             '', 'gi'
--           ) ~* '(auth\.uid\s*\(|(^|[^_[:alnum:]])es_interno\s*\(|(^|[^_[:alnum:]])es_gestor\s*\(|(^|[^_[:alnum:]])es_administrativo\s*\()';
--
-- 1b) Y al revés: que el InitPlan aparezca de verdad en el plan. Con una sesión
--     de usuario real (o `set role authenticated` + el claim del JWT), esto debe
--     mostrar `Filter: (InitPlan 1).col1` y no `Filter: es_interno()`:
--
--     explain (analyze, timing off) select id, monto from public.sales;
--
-- 2) Que no se haya perdido ni ganado ninguna política. Los dos conteos deben
--    coincidir:
--
--    select (select count(*) from pg_policies where schemaname='public') as ahora,
--           (select count(*) from public.zz_respaldo_policies_20260824)  as antes;
--
-- 3) Que ninguna cambió de comando o de roles (debe devolver 0 filas):
--
--    select coalesce(a.policyname, b.policyname) as politica,
--           coalesce(a.tablename,  b.tablename)  as tabla,
--           a.cmd as cmd_antes, b.cmd as cmd_ahora,
--           a.roles as roles_antes, b.roles as roles_ahora
--      from public.zz_respaldo_policies_20260824 a
--      full join pg_policies b
--        on b.schemaname = 'public'
--       and b.tablename  = a.tablename
--       and b.policyname = a.policyname
--     where a.policyname is null
--        or b.policyname is null
--        or a.cmd <> b.cmd
--        or a.roles::text <> b.roles::text;
-- ============================================================================
