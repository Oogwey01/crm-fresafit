-- ============================================================
-- APLICAR-EN-VIVO.sql  —  Fresafit CRM
-- Pega TODO esto en Supabase > SQL Editor y dale RUN.
-- Son las 4 migraciones del modulo de tareas, seguras de re-ejecutar.
-- ============================================================

-- >>>>>>>>>>>>>>>>>>>>>> migrations/20250102000000_roles_areas_estados.sql
-- ============================================================================
-- Fresafit CRM — Migración: 4 roles, áreas del spec, estados/prioridades
-- ----------------------------------------------------------------------------
-- Amplía el baseline de Aaron al spec completo. Es ADITIVA e idempotente en lo
-- posible. Primero re-mapea los datos existentes y LUEGO endurece los CHECK,
-- para no romper filas ya guardadas.
--
-- Cambios:
--   * profiles.rol: admin/miembro  ->  direccion/coordinador/miembro/externo
--     (admin existente se convierte en 'direccion').
--   * Áreas nuevas (spec): direccion, operaciones, diseno, contenido, logistica, tech.
--   * Estado en_progreso -> en_proceso.
--   * Prioridad: se elimina 'urgente' (se mapea a 'alta').
--   * Helpers de rol: mi_rol(), mi_area(), es_gestor(); es_admin() pasa a
--     significar 'direccion' (compatibilidad con las policies de tablas esqueleto).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Re-mapear DATOS existentes ANTES de cambiar los CHECK.
-- ---------------------------------------------------------------------------
update public.profiles set rol = 'direccion' where rol = 'admin';

update public.tasks set estado = 'en_proceso' where estado = 'en_progreso';
update public.tasks set prioridad = 'alta'    where prioridad = 'urgente';

-- Áreas viejas -> nuevas (mapeo sensato; los datos de ejemplo se re-siembran igual).
--   operaciones -> operaciones     marketing  -> contenido
--   ventas      -> operaciones     inventario -> logistica
--   finanzas    -> direccion       general    -> direccion
update public.profiles set area = case area
  when 'marketing'  then 'contenido'
  when 'ventas'     then 'operaciones'
  when 'inventario' then 'logistica'
  when 'finanzas'   then 'direccion'
  when 'general'    then 'direccion'
  else area end
where area is not null;

update public.tasks set area = case area
  when 'marketing'  then 'contenido'
  when 'ventas'     then 'operaciones'
  when 'inventario' then 'logistica'
  when 'finanzas'   then 'direccion'
  when 'general'    then 'direccion'
  else area end;

-- ---------------------------------------------------------------------------
-- 2) Reemplazar los CHECK (Postgres nombra los inline como <tabla>_<col>_check).
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_rol_check;
alter table public.profiles drop constraint if exists profiles_area_check;
alter table public.tasks    drop constraint if exists tasks_area_check;
alter table public.tasks    drop constraint if exists tasks_prioridad_check;
alter table public.tasks    drop constraint if exists tasks_estado_check;

alter table public.profiles
  add constraint profiles_rol_check
  check (rol in ('direccion','coordinador','miembro','externo'));

alter table public.profiles
  add constraint profiles_area_check
  check (area in ('direccion','operaciones','diseno','contenido','logistica','tech'));

alter table public.tasks
  add constraint tasks_area_check
  check (area in ('direccion','operaciones','diseno','contenido','logistica','tech'));

alter table public.tasks
  add constraint tasks_prioridad_check
  check (prioridad in ('baja','media','alta'));

alter table public.tasks
  add constraint tasks_estado_check
  check (estado in ('por_hacer','en_proceso','en_revision','hecho'));

-- El default de área 'general' ya no es válido; usar 'operaciones'.
alter table public.tasks alter column area set default 'operaciones';

-- ---------------------------------------------------------------------------
-- 3) Helpers de rol (SECURITY DEFINER para no disparar RLS recursivo).
-- ---------------------------------------------------------------------------
create or replace function public.mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from public.profiles where id = auth.uid();
$$;

create or replace function public.mi_area()
returns text language sql stable security definer set search_path = public as $$
  select area from public.profiles where id = auth.uid();
$$;

-- Gestor = dirección o coordinador (crean/asignan/editan todo el tablero).
create or replace function public.es_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and rol in ('direccion','coordinador')
  );
$$;

-- es_admin ahora significa "dirección" (compat con policies de tablas esqueleto).
create or replace function public.es_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = uid and rol = 'direccion');
$$;

grant execute on function public.mi_rol()    to authenticated;
grant execute on function public.mi_area()   to authenticated;
grant execute on function public.es_gestor() to authenticated;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>> migrations/20250102000001_tablas_satelite.sql
-- ============================================================================
-- Fresafit CRM — Migración: tablas satélite del módulo Tareas
-- ----------------------------------------------------------------------------
-- Añade lo colaborativo del spec: comentarios (hilo), checklist de subtareas,
-- enlaces/URLs, historial de actividad, y "compartir con externo". Además una
-- columna `etiquetas` (text[]) en tasks (catálogo fijo en lib/catalogos.ts).
-- Cada satélite hereda la visibilidad de su tarea vía RLS (ver 20250102000003).
-- Idempotente.
-- ============================================================================

-- Etiquetas: arreglo de texto en la propia tarea (ligero; hereda RLS de tasks).
alter table public.tasks add column if not exists etiquetas text[] not null default '{}';

-- Comentarios (hilo con autor y fecha).
create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  autor      uuid references public.profiles(id) on delete set null,
  texto      text not null,
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments(task_id);

-- Checklist de subtareas.
create table if not exists public.task_checklist (
  id       uuid primary key default gen_random_uuid(),
  task_id  uuid not null references public.tasks(id) on delete cascade,
  texto    text not null,
  hecho    boolean not null default false,
  orden    int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists task_checklist_task_idx on public.task_checklist(task_id);

-- Enlaces / URLs (ej. diseño en Figma, doc, video).
create table if not exists public.task_links (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  titulo     text,
  url        text not null,
  created_at timestamptz not null default now()
);
create index if not exists task_links_task_idx on public.task_links(task_id);

-- Historial de actividad (quién cambió qué y cuándo). Lo llenan triggers y actions.
create table if not exists public.task_activity (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  autor      uuid references public.profiles(id) on delete set null,
  texto      text not null,
  created_at timestamptz not null default now()
);
create index if not exists task_activity_task_idx on public.task_activity(task_id);

-- Compartir una tarea con usuarios concretos (base del acceso EXTERNO).
create table if not exists public.task_shares (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (task_id, user_id)
);
create index if not exists task_shares_user_idx on public.task_shares(user_id);

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>> migrations/20250102000002_storage_adjuntos.sql
-- ============================================================================
-- Fresafit CRM — Migración: adjuntos (Supabase Storage) + metadatos
-- ----------------------------------------------------------------------------
-- Crea el bucket privado `adjuntos` y una tabla de metadatos `task_attachments`.
-- Los archivos se guardan en Storage con la convención de ruta:
--     adjuntos/<task_id>/<archivo>
-- Las policies de acceso (a storage.objects y a la tabla) se definen en la
-- migración de RLS (20250102000003), espejando la visibilidad de la tarea.
-- Idempotente.
-- ============================================================================

-- Bucket privado (no público: se sirve con URLs firmadas o vía RLS).
insert into storage.buckets (id, name, public)
values ('adjuntos', 'adjuntos', false)
on conflict (id) do nothing;

-- Metadatos del adjunto (el binario vive en Storage; aquí guardamos la ruta).
create table if not exists public.task_attachments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  autor        uuid references public.profiles(id) on delete set null,
  nombre       text not null,
  storage_path text not null,
  tipo         text,
  created_at   timestamptz not null default now()
);
create index if not exists task_attachments_task_idx on public.task_attachments(task_id);

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>> migrations/20250102000003_rls.sql
-- ============================================================================
-- Fresafit CRM — Migración: RLS por rol + triggers de actividad
-- ----------------------------------------------------------------------------
-- Reemplaza el "tablero abierto" del baseline por permisos por rol (spec):
--   * direccion / coordinador (gestor): ven y editan TODO; crean y asignan.
--   * miembro: ve su ÁREA + las tareas asignadas a él (+ las compartidas);
--     de las SUYAS solo mueve el estado, comenta y adjunta.
--   * externo: solo lo que se le comparta explícitamente.
-- La restricción "miembro solo cambia estado" se refuerza con un trigger
-- (RLS es a nivel fila, no columna). Idempotente.
-- ============================================================================

-- Exponer las tablas nuevas a la API (RLS sigue gobernando las filas).
grant all on all tables    in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant execute on function public.puede_ver_tarea(uuid)        to anon, authenticated;
grant execute on function public.puede_contribuir_tarea(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers de visibilidad (SECURITY DEFINER: leen tasks sin recursión de RLS).
-- ---------------------------------------------------------------------------
create or replace function public.puede_ver_tarea(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.es_gestor()
    or exists (
      select 1 from public.tasks t
      where t.id = tid
        and ( t.responsable_id = auth.uid()
              or (public.mi_rol() = 'miembro' and t.area = public.mi_area()) )
    )
    or exists (
      select 1 from public.task_shares s
      where s.task_id = tid and s.user_id = auth.uid()
    );
$$;

-- Quién puede APORTAR (checklist/enlaces/adjuntos/comentarios) en una tarea:
-- gestor o la persona responsable.
create or replace function public.puede_contribuir_tarea(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_gestor()
      or exists (select 1 from public.tasks t where t.id = tid and t.responsable_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Habilitar RLS en las tablas nuevas.
-- ---------------------------------------------------------------------------
alter table public.task_comments    enable row level security;
alter table public.task_checklist   enable row level security;
alter table public.task_links        enable row level security;
alter table public.task_activity     enable row level security;
alter table public.task_shares       enable row level security;
alter table public.task_attachments  enable row level security;

-- ============================ tasks (reescritura) ===========================
drop policy if exists "tareas: leer (autenticados)" on public.tasks;
drop policy if exists "tareas: crear (dueño = usuario actual)" on public.tasks;
drop policy if exists "tareas: editar/mover (tablero compartido)" on public.tasks;
drop policy if exists "tareas: borrar propias o admin" on public.tasks;

create policy "tareas: ver segun rol" on public.tasks
  for select to authenticated using (public.puede_ver_tarea(id));

create policy "tareas: crear (solo gestor)" on public.tasks
  for insert to authenticated
  with check (public.es_gestor() and created_by = auth.uid());

create policy "tareas: editar (gestor o responsable)" on public.tasks
  for update to authenticated
  using (public.es_gestor() or responsable_id = auth.uid())
  with check (public.es_gestor() or responsable_id = auth.uid());

create policy "tareas: borrar (solo gestor)" on public.tasks
  for delete to authenticated using (public.es_gestor());

-- Trigger: un NO-gestor solo puede cambiar `estado` (y solo si es responsable).
create or replace function public.restringir_update_tarea()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or public.es_gestor() then
    return new;
  end if;
  if old.responsable_id is distinct from auth.uid() then
    raise exception 'Solo la responsable o dirección/coordinación puede modificar esta tarea.';
  end if;
  -- Miembro responsable: se conservan todas las columnas salvo `estado`.
  new.titulo         := old.titulo;
  new.descripcion    := old.descripcion;
  new.responsable_id := old.responsable_id;
  new.area           := old.area;
  new.prioridad      := old.prioridad;
  new.fecha_limite   := old.fecha_limite;
  new.etiquetas      := old.etiquetas;
  return new;
end;
$$;

drop trigger if exists tasks_restringir_update on public.tasks;
create trigger tasks_restringir_update
  before update on public.tasks
  for each row execute function public.restringir_update_tarea();

-- ============================ task_comments =================================
drop policy if exists "comentarios: ver" on public.task_comments;
create policy "comentarios: ver" on public.task_comments
  for select to authenticated using (public.puede_ver_tarea(task_id));

drop policy if exists "comentarios: crear" on public.task_comments;
create policy "comentarios: crear" on public.task_comments
  for insert to authenticated
  with check (public.puede_ver_tarea(task_id) and autor = auth.uid());

drop policy if exists "comentarios: borrar propio o gestor" on public.task_comments;
create policy "comentarios: borrar propio o gestor" on public.task_comments
  for delete to authenticated using (autor = auth.uid() or public.es_gestor());

-- ============================ task_checklist ================================
drop policy if exists "checklist: ver" on public.task_checklist;
create policy "checklist: ver" on public.task_checklist
  for select to authenticated using (public.puede_ver_tarea(task_id));

drop policy if exists "checklist: aportar" on public.task_checklist;
create policy "checklist: aportar" on public.task_checklist
  for all to authenticated
  using (public.puede_contribuir_tarea(task_id))
  with check (public.puede_contribuir_tarea(task_id));

-- ============================ task_links ====================================
drop policy if exists "enlaces: ver" on public.task_links;
create policy "enlaces: ver" on public.task_links
  for select to authenticated using (public.puede_ver_tarea(task_id));

drop policy if exists "enlaces: aportar" on public.task_links;
create policy "enlaces: aportar" on public.task_links
  for all to authenticated
  using (public.puede_contribuir_tarea(task_id))
  with check (public.puede_contribuir_tarea(task_id));

-- ============================ task_attachments ==============================
drop policy if exists "adjuntos: ver" on public.task_attachments;
create policy "adjuntos: ver" on public.task_attachments
  for select to authenticated using (public.puede_ver_tarea(task_id));

drop policy if exists "adjuntos: crear" on public.task_attachments;
create policy "adjuntos: crear" on public.task_attachments
  for insert to authenticated
  with check (public.puede_contribuir_tarea(task_id) and autor = auth.uid());

drop policy if exists "adjuntos: borrar propio o gestor" on public.task_attachments;
create policy "adjuntos: borrar propio o gestor" on public.task_attachments
  for delete to authenticated using (autor = auth.uid() or public.es_gestor());

-- ============================ task_activity =================================
drop policy if exists "actividad: ver" on public.task_activity;
create policy "actividad: ver" on public.task_activity
  for select to authenticated using (public.puede_ver_tarea(task_id));

drop policy if exists "actividad: registrar" on public.task_activity;
create policy "actividad: registrar" on public.task_activity
  for insert to authenticated
  with check (public.puede_ver_tarea(task_id));

-- ============================ task_shares ===================================
drop policy if exists "compartir: ver" on public.task_shares;
create policy "compartir: ver" on public.task_shares
  for select to authenticated
  using (public.es_gestor() or user_id = auth.uid());

drop policy if exists "compartir: gestionar (solo gestor)" on public.task_shares;
create policy "compartir: gestionar (solo gestor)" on public.task_shares
  for all to authenticated
  using (public.es_gestor()) with check (public.es_gestor());

-- ---------------------------------------------------------------------------
-- Storage: bucket `adjuntos`. Acceso espejando la visibilidad de la tarea.
-- Ruta: adjuntos/<task_id>/<archivo>  => task_id = primer segmento de la ruta.
-- ---------------------------------------------------------------------------
drop policy if exists "adjuntos storage: ver" on storage.objects;
create policy "adjuntos storage: ver" on storage.objects
  for select to authenticated
  using (bucket_id = 'adjuntos'
         and public.puede_ver_tarea(((storage.foldername(name))[1])::uuid));

drop policy if exists "adjuntos storage: subir" on storage.objects;
create policy "adjuntos storage: subir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'adjuntos'
              and public.puede_contribuir_tarea(((storage.foldername(name))[1])::uuid));

drop policy if exists "adjuntos storage: borrar" on storage.objects;
create policy "adjuntos storage: borrar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'adjuntos' and (public.es_gestor() or owner = auth.uid()));

-- ---------------------------------------------------------------------------
-- Historial de actividad automático (crear / mover / reasignar / comentar / adjuntar).
-- ---------------------------------------------------------------------------
create or replace function public.etiqueta_estado(e text)
returns text language sql immutable as $$
  select case e
    when 'por_hacer'   then 'Por hacer'
    when 'en_proceso'  then 'En proceso'
    when 'en_revision' then 'En revisión'
    when 'hecho'       then 'Hecho'
    else e end;
$$;

create or replace function public.log_actividad_tarea()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_activity (task_id, autor, texto)
      values (new.id, new.created_by, 'creó la tarea');
    return new;
  end if;
  -- UPDATE
  if new.estado is distinct from old.estado then
    insert into public.task_activity (task_id, autor, texto)
      values (new.id, auth.uid(),
        'movió de «'||public.etiqueta_estado(old.estado)||'» a «'||public.etiqueta_estado(new.estado)||'»');
  end if;
  if new.responsable_id is distinct from old.responsable_id then
    insert into public.task_activity (task_id, autor, texto)
      values (new.id, auth.uid(), 'reasignó la tarea');
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_log_actividad on public.tasks;
create trigger tasks_log_actividad
  after insert or update on public.tasks
  for each row execute function public.log_actividad_tarea();

create or replace function public.log_actividad_comentario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.task_activity (task_id, autor, texto)
    values (new.task_id, new.autor, 'agregó un comentario');
  return new;
end;
$$;
drop trigger if exists comments_log_actividad on public.task_comments;
create trigger comments_log_actividad
  after insert on public.task_comments
  for each row execute function public.log_actividad_comentario();

create or replace function public.log_actividad_adjunto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.task_activity (task_id, autor, texto)
    values (new.task_id, new.autor, 'adjuntó «'||new.nombre||'»');
  return new;
end;
$$;
drop trigger if exists attachments_log_actividad on public.task_attachments;
create trigger attachments_log_actividad
  after insert on public.task_attachments
  for each row execute function public.log_actividad_adjunto();

notify pgrst, 'reload schema';

