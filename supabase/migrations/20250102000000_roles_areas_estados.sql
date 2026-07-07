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
