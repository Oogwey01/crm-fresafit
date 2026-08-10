-- ============================================================================
-- 20260926000000_maquila_storage.sql
--   El bucket privado del módulo: guías, diseños y comprobantes de anticipo.
-- ----------------------------------------------------------------------------
-- Un solo bucket con tres carpetas en vez de tres buckets, porque lo que
-- cambia entre ellas no es el almacenamiento sino QUIÉN puede mirar:
--
--   guias/<guia_id>/<archivo>          logística sube, Eduardo descarga
--   disenos/<diseno_id>/<archivo>      el equipo sube, Eduardo descarga
--   anticipos/<anticipo_id>/<archivo>  dinero: Eduardo NO entra
--
-- El corte lo hace el primer segmento de la ruta, el mismo truco de los
-- buckets `adjuntos` (20250102000002) y `empresas` (20260916000000): la
-- carpeta ES el permiso, así que una carpeta nueva no se abre sola.
--
-- El maquilero nunca escribe binarios: sube el equipo, él solo descarga. Y
-- borrar es de administración — una guía subida no la tira cualquiera.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

insert into storage.buckets (id, name, public)
values ('maquila', 'maquila', false)
on conflict (id) do nothing;

-- Las carpetas que el maquilero puede mirar. Enumeradas en positivo a
-- propósito: `anticipos` no está, y una carpeta futura tampoco lo estará
-- hasta que alguien la agregue aquí a mano.
create or replace function public.maquilero_ve_carpeta_maquila(ruta text)
returns boolean language sql immutable as $$
  select (storage.foldername(ruta))[1] in ('guias', 'disenos');
$$;

comment on function public.maquilero_ve_carpeta_maquila(text) is
  'Corte por carpeta del bucket `maquila`: el maquilero solo alcanza guias/ y disenos/. Los comprobantes de anticipo quedan fuera por omisión.';

grant execute on function public.maquilero_ve_carpeta_maquila(text) to authenticated;

drop policy if exists "maquila storage: ver (interno)" on storage.objects;
create policy "maquila storage: ver (interno)" on storage.objects
  for select to authenticated
  using (bucket_id = 'maquila' and (select public.es_interno()));

drop policy if exists "maquila storage: ver (maquilero)" on storage.objects;
create policy "maquila storage: ver (maquilero)" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'maquila'
    and (select public.es_maquilero())
    and public.maquilero_ve_carpeta_maquila(name)
  );

drop policy if exists "maquila storage: subir" on storage.objects;
create policy "maquila storage: subir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'maquila' and (select public.es_interno()));

drop policy if exists "maquila storage: borrar" on storage.objects;
create policy "maquila storage: borrar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'maquila' and (select public.es_administrativo()));

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select id, public from storage.buckets where id = 'maquila';   -- public = false
--   select policyname from pg_policies
--    where schemaname = 'storage' and policyname like 'maquila storage%';  -- 4
--   select public.maquilero_ve_carpeta_maquila('guias/x/y.pdf');      -- true
--   select public.maquilero_ve_carpeta_maquila('anticipos/x/y.pdf');  -- false
-- ============================================================================
