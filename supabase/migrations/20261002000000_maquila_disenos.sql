-- ============================================================================
-- 20261002000000_maquila_disenos.sql
--   Que Eduardo vea el diseño en el CRM, y no por WhatsApp.
-- ----------------------------------------------------------------------------
-- Hoy, cuando entra un personalizado, alguien copia una liga firmada y se la
-- manda por chat (ligaDisenoParaProveedor, app/(app)/personalizados). Funciona,
-- pero el diseño vive fuera del pedido: si el chat se pierde, se pierde.
--
-- Dos caminos, según de dónde salga el arte:
--
--   1. PERSONALIZADOS. El pedido apunta al personalizado y Eduardo ve SU
--      imagen — la misma, sin duplicar el binario: se amplía la policy del
--      bucket `personalizados` con una rama que exige que exista un pedido de
--      maquila ligado y ya pagado. Funciona porque subirFotoPersonalizado
--      guarda en <personalizado_id>/<archivo> y la policy mira esa carpeta.
--
--   2. COLECCIONES. La biblioteca (`maquila_disenos`): «mañana sale Batman,
--      ya tenemos los diseños definidos, descárgalo, mándalo a imprimir». Es
--      lo que permite sacar colecciones sin fabricar stock por adelantado.
--
-- `diseno_listo_en` es «producto listo de parte de Fresa Fit»: el momento en
-- que el arte queda entregado y empieza a correr lo nuestro. Bandera, no
-- estado — el enum de maquila_pedidos no crece (ver 20260926000100).
--
-- OJO: la policy de lectura del bucket `personalizados` se RECREA. Hay que
-- pegar el archivo completo, o el equipo interno pierde el acceso.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. La biblioteca de diseños de colección.
-- ---------------------------------------------------------------------------
create table if not exists public.maquila_disenos (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,          -- "Batman", "México"
  coleccion      text,                   -- "Septiembre 2026"
  acabado        text check (acabado in ('prensado','sublimado','bordado','bordado_gamuza')),
  archivo_path   text,                   -- bucket `maquila`, disenos/<id>/<archivo>
  archivo_nombre text,
  archivo_mime   text,
  activo         boolean not null default true,
  notas          text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.maquila_disenos is
  'Biblioteca de artes listos para producir. Es lo que permite sacar colecciones sobre venta, sin stock: sale el pedido, Eduardo descarga el diseño y lo manda a imprimir.';

create index if not exists maquila_disenos_coleccion_idx  on public.maquila_disenos (coleccion, nombre);
create index if not exists maquila_disenos_created_by_idx on public.maquila_disenos (created_by);

drop trigger if exists maquila_disenos_touch_trg on public.maquila_disenos;
create trigger maquila_disenos_touch_trg
  before update on public.maquila_disenos
  for each row execute function public.maquila_touch();

-- ---------------------------------------------------------------------------
-- 2. El pedido apunta a su arte.
--
-- Columnas nuevas en maquila_pedidos: quedan congeladas para el maquilero SIN
-- tocar nada, porque validar_cambio_maquila compara todo lo que no está en su
-- lista blanca (to_jsonb(new) - permitidas). Él las lee; escribirlas es del
-- equipo.
-- ---------------------------------------------------------------------------
alter table public.maquila_pedidos
  add column if not exists personalizado_id uuid references public.personalizados(id) on delete set null,
  add column if not exists diseno_id        uuid references public.maquila_disenos(id) on delete set null,
  add column if not exists diseno_listo_en  timestamptz,
  add column if not exists diseno_listo_por uuid references public.profiles(id) on delete set null;

comment on column public.maquila_pedidos.diseno_listo_en is
  'Cuándo quedó entregado el arte («producto listo de parte de Fresa Fit»). Desde aquí el retraso ya es del taller, no del diseño.';

create index if not exists maquila_ped_personalizado_idx on public.maquila_pedidos (personalizado_id);
create index if not exists maquila_ped_diseno_idx        on public.maquila_pedidos (diseno_id);
create index if not exists maquila_ped_diseno_listo_idx  on public.maquila_pedidos (diseno_listo_por);

-- ---------------------------------------------------------------------------
-- 3. RLS de la biblioteca: la ve el equipo, y el maquilero solo lo activo.
-- ---------------------------------------------------------------------------
grant all on public.maquila_disenos to authenticated, service_role;

alter table public.maquila_disenos enable row level security;

drop policy if exists "maquila disenos: ver (interno)" on public.maquila_disenos;
create policy "maquila disenos: ver (interno)" on public.maquila_disenos
  for select to authenticated using ((select public.es_interno()));

drop policy if exists "maquila disenos: ver (maquilero)" on public.maquila_disenos;
create policy "maquila disenos: ver (maquilero)" on public.maquila_disenos
  for select to authenticated
  using ((select public.es_maquilero()) and activo);

drop policy if exists "maquila disenos: gestionar (interno)" on public.maquila_disenos;
create policy "maquila disenos: gestionar (interno)" on public.maquila_disenos
  for all to authenticated
  using ((select public.es_interno()))
  with check ((select public.es_interno()));

-- ---------------------------------------------------------------------------
-- 4. La rama que le abre a Eduardo el diseño de un personalizado.
--
-- Se comprueba contra la LIGA, no contra el rol a secas: ve el arte de los
-- personalizados que tiene que producir, y de ninguno más. Y solo cuando el
-- pedido ya salió de «esperando pago», igual que su tablero.
-- ---------------------------------------------------------------------------
create or replace function public.maquilero_ve_personalizado(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_maquilero() and exists (
    select 1 from public.maquila_pedidos p
     where p.personalizado_id = pid and p.estado <> 'esperando_pago'
  );
$$;
grant execute on function public.maquilero_ve_personalizado(uuid) to authenticated;

comment on function public.maquilero_ve_personalizado(uuid) is
  'El maquilero alcanza el diseño de un personalizado solo si hay un pedido de maquila suyo ligado a él y ya pagado.';

-- Se RECREA (no se agrega): pegar completo o el equipo interno pierde acceso.
drop policy if exists "personalizados storage: ver" on storage.objects;
create policy "personalizados storage: ver" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'personalizados'
    and (
      (select public.es_interno())
      or public.maquilero_ve_personalizado(((storage.foldername(name))[1])::uuid)
    )
  );

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'maquila_pedidos'
--      and column_name in ('personalizado_id','diseno_id','diseno_listo_en');   -- 3
--   select policyname from pg_policies where tablename = 'maquila_disenos';     -- 3
--   select policyname from pg_policies
--    where schemaname = 'storage' and policyname = 'personalizados storage: ver';
--   -- Cuántos pedidos de maquila tienen su personalizado ligado:
--   select count(*) filter (where personalizado_id is not null) as ligados,
--          count(*) as total
--     from public.maquila_pedidos where acabado <> 'prensado';
-- ============================================================================
