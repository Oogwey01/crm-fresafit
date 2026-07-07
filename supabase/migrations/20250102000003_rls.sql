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
