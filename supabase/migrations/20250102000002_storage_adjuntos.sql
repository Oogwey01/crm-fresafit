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
