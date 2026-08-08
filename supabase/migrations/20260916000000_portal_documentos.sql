-- ============================================================================
-- 20260916000000_portal_documentos.sql — Fase 2: el archivo de documentos
-- ----------------------------------------------------------------------------
-- Todo lo que se intercambia con una empresa cliente vive hoy en un hilo de
-- WhatsApp: la constancia de situación fiscal, el contrato, el registro
-- COFEPRIS, el brandbook. Cuando hace falta uno, se busca hacia atrás en el chat
-- —y si quien lo tenía ya no está, no aparece—.
--
-- Dos tablas y no una, porque un documento y su archivo NO son lo mismo:
--
--   empresa_documentos            el documento como CONCEPTO: «Constancia de
--                                 situación fiscal de Nutravia». Tiene categoría,
--                                 vigencia y nivel de visibilidad.
--   empresa_documento_versiones   cada archivo que ha representado ese concepto.
--
-- Esa separación es la que permite lo que se pidió: reemplazar un documento sin
-- perder el anterior. La constancia de 2026 no borra la de 2025 — se vuelve la
-- versión 2, y la 1 sigue ahí para cuando alguien pregunte qué se entregó en su
-- momento. Si el archivo fuera una columna de la tabla, «actualizar» sería
-- perder.
--
-- Nada se borra: `archivado_at`. No hay policy de DELETE en ninguna de las dos,
-- ni sobre el bucket.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) El documento
-- ---------------------------------------------------------------------------
create table if not exists public.empresa_documentos (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.agencia_empresas(id) on delete restrict,
  nombre       text not null,
  -- Las ocho del acuerdo. `fiscal` y `sanitario` son las que caducan y por las
  -- que existe la alerta de vencimiento.
  categoria    text not null default 'otros'
               check (categoria in ('fiscal','legal','facturas_pagos','sanitario',
                                    'marca','producto','operacion','otros')),
  descripcion  text,
  -- Etiquetas libres, además de la categoría: la categoría es UNA y cerrada;
  -- las etiquetas son las palabras con las que cada quien lo va a buscar.
  etiquetas    text[] not null default '{}',
  visibilidad  text not null default 'interno'
               check (visibilidad in ('privado','interno','compartido')),
  -- Hasta cuándo sirve. Es lo que convierte el archivo en algo vivo: sin esta
  -- fecha, una constancia vencida se ve igual que una al día.
  vigente_hasta date,
  -- Cuándo se avisó de que estaba por vencer. Sella el aviso para no repetirlo
  -- cada vez que corre el cron (que corre a diario).
  aviso_vencimiento_en timestamptz,
  archivado_at timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

comment on table public.empresa_documentos is
  'Los papeles que se intercambian con cada empresa cliente. No se borran: se archivan (archivado_at). El archivo en sí vive en empresa_documento_versiones, una fila por versión.';

create index if not exists empresa_documentos_empresa_idx
  on public.empresa_documentos(empresa_id, categoria) where archivado_at is null;
-- El barrido del cron: los que caducan y aún no se han avisado.
create index if not exists empresa_documentos_vigencia_idx
  on public.empresa_documentos(vigente_hasta)
  where vigente_hasta is not null and archivado_at is null;
-- Búsqueda por etiqueta libre (`.contains()` de PostgREST).
create index if not exists empresa_documentos_etiquetas_idx
  on public.empresa_documentos using gin (etiquetas);

drop trigger if exists empresa_documentos_touch on public.empresa_documentos;
create trigger empresa_documentos_touch
  before update on public.empresa_documentos
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Las versiones
-- ---------------------------------------------------------------------------
create table if not exists public.empresa_documento_versiones (
  id            uuid primary key default gen_random_uuid(),
  documento_id  uuid not null references public.empresa_documentos(id) on delete cascade,
  version       integer not null check (version >= 1),
  storage_path  text not null,
  nombre_archivo text not null,
  mime          text,
  tamano        bigint,
  nota          text,                      -- «la que mandaron el 3 de agosto»
  subido_por    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (documento_id, version)
);

create index if not exists empresa_doc_versiones_doc_idx
  on public.empresa_documento_versiones(documento_id, version desc);

-- Qué número le toca a la siguiente versión. Va en la base y no en la app
-- porque dos personas subiendo a la vez calcularían el mismo número desde el
-- navegador; aquí el índice único (documento_id, version) frena a la segunda.
create or replace function public.siguiente_version_documento(did uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(max(version), 0) + 1
    from public.empresa_documento_versiones where documento_id = did;
$$;

grant execute on function public.siguiente_version_documento(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Quién ve un documento
-- ---------------------------------------------------------------------------
-- Aquí SÍ vale una función que busca la fila: la usan las versiones y las
-- policies de Storage, que preguntan por un documento que YA existe. La policy
-- de SELECT de `empresa_documentos` va por columnas, como la de `tasks` — misma
-- trampa del INSERT … RETURNING (ver 20260907000000).
create or replace function public.puede_ver_documento(did uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.empresa_documentos d
    where d.id = did
      and case
        when public.es_externo() then
          d.empresa_id = public.mi_empresa()
          and d.visibilidad = 'compartido'
          and d.archivado_at is null
        else
          public.es_interno()
          and (
            d.visibilidad <> 'privado'
            or public.es_admin(auth.uid())
            or d.created_by = auth.uid()
          )
      end
  );
$$;

grant execute on function public.puede_ver_documento(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) RLS
-- ---------------------------------------------------------------------------
grant all on public.empresa_documentos, public.empresa_documento_versiones
  to authenticated, service_role;

alter table public.empresa_documentos          enable row level security;
alter table public.empresa_documento_versiones enable row level security;

-- Ver: las dos mitades, cada una con su candado de rol (las policies se suman,
-- ver la nota de 20260915000000).
drop policy if exists "documentos: ver (interno)" on public.empresa_documentos;
create policy "documentos: ver (interno)" on public.empresa_documentos
  for select to authenticated
  using (
    (select public.es_interno())
    and (
      visibilidad <> 'privado'
      or (select public.es_admin(auth.uid()))
      or created_by = (select auth.uid())
    )
  );

drop policy if exists "documentos: ver (externo)" on public.empresa_documentos;
create policy "documentos: ver (externo)" on public.empresa_documentos
  for select to authenticated
  using (
    (select public.es_externo())
    and empresa_id = (select public.mi_empresa())
    and visibilidad = 'compartido'
    and archivado_at is null
  );

-- Subir: el equipo, para cualquier cliente.
drop policy if exists "documentos: crear (interno)" on public.empresa_documentos;
create policy "documentos: crear (interno)" on public.empresa_documentos
  for insert to authenticated
  with check ((select public.es_interno()) and created_by = (select auth.uid()));

-- Y el cliente, para lo suyo y siempre compartido: si nos lo manda, es para que
-- lo veamos. Los DOS papeles del portal suben —el colaborador también—, porque
-- mandar la constancia es justo lo que hace la persona de administración de esa
-- empresa, que no tiene por qué ser su administradora en el CRM.
drop policy if exists "documentos: crear (cliente)" on public.empresa_documentos;
create policy "documentos: crear (cliente)" on public.empresa_documentos
  for insert to authenticated
  with check (
    (select public.es_externo())
    and created_by = (select auth.uid())
    and empresa_id = (select public.mi_empresa())
    and visibilidad = 'compartido'
    and archivado_at is null
  );

-- Editar los datos (categoría, vigencia, etiquetas, archivar, compartir): del
-- equipo. Lo que el cliente sube se queda como lo subió; si hay que corregirlo,
-- lo corrige quien lo recibe.
drop policy if exists "documentos: editar (interno)" on public.empresa_documentos;
create policy "documentos: editar (interno)" on public.empresa_documentos
  for update to authenticated
  using ((select public.es_interno()))
  with check ((select public.es_interno()));

-- Sin policy de DELETE, a propósito: el archivo de un cliente no se borra.

-- Versiones: se ven y se agregan si se puede ver el documento. No se editan ni
-- se borran NUNCA — es lo que hace que el histórico sea histórico.
drop policy if exists "versiones: ver" on public.empresa_documento_versiones;
create policy "versiones: ver" on public.empresa_documento_versiones
  for select to authenticated using (public.puede_ver_documento(documento_id));

drop policy if exists "versiones: agregar" on public.empresa_documento_versiones;
create policy "versiones: agregar" on public.empresa_documento_versiones
  for insert to authenticated
  with check (public.puede_ver_documento(documento_id) and subido_por = (select auth.uid()));

revoke update, delete on public.empresa_documento_versiones from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 5) El bucket
-- ---------------------------------------------------------------------------
-- Privado, como todos los del CRM salvo las fotos de producto. Ruta:
--   empresas/<documento_id>/v<n>-<archivo>
-- El primer segmento es el documento, que es lo que miran las policies —el
-- mismo truco del bucket `adjuntos` (20250102000002)—.
insert into storage.buckets (id, name, public)
values ('empresas', 'empresas', false)
on conflict (id) do nothing;

drop policy if exists "empresas storage: ver" on storage.objects;
create policy "empresas storage: ver" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'empresas'
    and public.puede_ver_documento(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "empresas storage: subir" on storage.objects;
create policy "empresas storage: subir" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'empresas'
    and public.puede_ver_documento(((storage.foldername(name))[1])::uuid)
  );

-- Sin policy de borrado: el binario de una versión vieja tampoco se tira.

-- ---------------------------------------------------------------------------
-- 6) Todo queda en el registro
-- ---------------------------------------------------------------------------
create or replace function public.log_actividad_documento()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor  uuid := auth.uid();
  v_nombre text;
begin
  select nombre into v_nombre from public.profiles where id = v_actor;

  if tg_op = 'INSERT' then
    insert into public.actividad_empresas
      (empresa_id, actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
    values (new.empresa_id, v_actor, v_nombre, 'documento_creado', 'documento', new.id,
            jsonb_build_object('nombre', new.nombre, 'categoria', new.categoria,
                               'visibilidad', new.visibilidad));
    return new;
  end if;

  if new.visibilidad is distinct from old.visibilidad then
    insert into public.actividad_empresas
      (empresa_id, actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
    values (new.empresa_id, v_actor, v_nombre, 'visibilidad_cambiada', 'documento', new.id,
            jsonb_build_object('nombre', new.nombre, 'antes', old.visibilidad,
                               'despues', new.visibilidad));
  end if;

  if new.archivado_at is distinct from old.archivado_at then
    insert into public.actividad_empresas
      (empresa_id, actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
    values (new.empresa_id, v_actor, v_nombre,
            case when new.archivado_at is null then 'documento_restaurado' else 'documento_archivado' end,
            'documento', new.id, jsonb_build_object('nombre', new.nombre));
  end if;

  return new;
end;
$$;

drop trigger if exists empresa_documentos_log on public.empresa_documentos;
create trigger empresa_documentos_log
  after insert or update on public.empresa_documentos
  for each row execute function public.log_actividad_documento();

-- Una versión nueva es un hecho por sí mismo: «el 3 de agosto mandaron la
-- constancia actualizada» es media discusión resuelta.
create or replace function public.log_actividad_version_documento()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor   uuid := auth.uid();
  v_nombre  text;
  v_empresa uuid;
  v_doc     text;
begin
  select nombre into v_nombre from public.profiles where id = v_actor;
  select empresa_id, nombre into v_empresa, v_doc
    from public.empresa_documentos where id = new.documento_id;

  insert into public.actividad_empresas
    (empresa_id, actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
  values (v_empresa, v_actor, v_nombre, 'documento_version', 'documento', new.documento_id,
          jsonb_build_object('nombre', v_doc, 'version', new.version,
                             'archivo', new.nombre_archivo));
  return new;
end;
$$;

drop trigger if exists empresa_doc_versiones_log on public.empresa_documento_versiones;
create trigger empresa_doc_versiones_log
  after insert on public.empresa_documento_versiones
  for each row execute function public.log_actividad_version_documento();

-- ---------------------------------------------------------------------------
-- 7) Autocomprobación
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  -- El bucket, y que sea privado. Uno público dejaría los contratos de un
  -- cliente colgando de una URL adivinable.
  select not public into v_ok from storage.buckets where id = 'empresas';
  if v_ok is null then
    raise exception 'El bucket `empresas` no se creó.';
  end if;
  if not v_ok then
    raise exception 'El bucket `empresas` quedó PÚBLICO. No sigas: ahí van contratos y constancias.';
  end if;

  -- Y que las versiones no se puedan editar.
  select not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'empresa_documento_versiones'
       and cmd in ('UPDATE','DELETE')
  ) into v_ok;
  if not v_ok then
    raise exception 'Las versiones de documento admiten UPDATE o DELETE: el histórico dejaría de serlo.';
  end if;

  raise notice 'OK — bucket privado y versiones inmutables.';
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   -- Las dos mitades de la lectura, cada una con su candado de rol:
--   select policyname, cmd, qual from pg_policies
--    where schemaname='public' and tablename='empresa_documentos';
--
--   -- Lo que verá el cron de vencimientos (nada todavía):
--   select nombre, vigente_hasta from public.empresa_documentos
--    where vigente_hasta is not null and archivado_at is null
--    order by vigente_hasta;
-- ============================================================================
