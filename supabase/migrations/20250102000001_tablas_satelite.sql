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
