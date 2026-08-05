-- ============================================================================
-- 20260819000000_administracion_tareas_agencia.sql
--   1) Rol y área nuevos: «administración»
--   2) Las tareas se separan por negocio: Fresafit / Agencia
-- ----------------------------------------------------------------------------
-- (1) Hasta hoy los módulos administrativos —gastos, nómina, reportes y toda la
-- Agencia— eran de `direccion` y de nadie más, porque solo dirección los usaba.
-- Con una administradora en el equipo eso deja de servir: necesita capturar
-- gastos, correr la nómina y cobrarles a los clientes de la agencia, pero NO
-- necesita poder cambiarle el rol a nadie ni tocar las ventas que bajan por API.
--
-- Por eso el corte no es "dirección sí, el resto no", sino dos niveles:
--
--   es_administrativo()  dirección + administración → gastos, nómina, reportes,
--                        agencia. Es el nivel de "lleva la administración".
--   es_admin(uid)        SOLO dirección → cambiar perfiles y roles del equipo,
--                        editar ventas importadas por API. Es el nivel de "manda".
--
-- `administracion` también es equipo interno y gestor del tablero: ve y asigna
-- tareas de todos, igual que coordinación.
--
-- (2) Las tareas eran una sola bolsa para los dos negocios. La agencia trabaja
-- por cliente (Nutravia, Bart Jerseys) y Fresafit no tiene cliente: mezclarlas
-- obligaba a filtrar mentalmente en cada vista. `tasks.espacio` las parte y
-- `tasks.empresa_id` dice de qué cliente es cada tarea de la agencia.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) El rol y el área nuevos
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_rol_check;
alter table public.profiles
  add constraint profiles_rol_check
  check (rol in ('direccion','administracion','coordinador','miembro','externo'));

alter table public.profiles drop constraint if exists profiles_area_check;
alter table public.profiles
  add constraint profiles_area_check
  check (area in ('direccion','administracion','operaciones','diseno','contenido','logistica','tech'));

alter table public.tasks drop constraint if exists tasks_area_check;
alter table public.tasks
  add constraint tasks_area_check
  check (area in ('direccion','administracion','operaciones','diseno','contenido','logistica','tech'));

-- ---------------------------------------------------------------------------
-- 2) Helpers de rol
-- ---------------------------------------------------------------------------
-- Interno = todo el equipo de casa (todo menos `externo`).
create or replace function public.es_interno()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and rol in ('direccion','administracion','coordinador','miembro')
  );
$$;

-- Gestor = quien manda en el tablero de tareas (ve todo, crea, asigna, borra).
create or replace function public.es_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and rol in ('direccion','administracion','coordinador')
  );
$$;

-- Administrativo = quien lleva el dinero y los papeles: dirección y administración.
-- Es el portero de gastos, nómina, reportes y todo el módulo Agencia.
create or replace function public.es_administrativo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and rol in ('direccion','administracion')
  );
$$;

-- es_admin(uid) NO cambia: sigue significando dirección a secas, y es lo que
-- protege los perfiles del equipo (cambiar roles) y las ventas de API.
grant execute on function public.es_interno()        to authenticated;
grant execute on function public.es_gestor()         to authenticated;
grant execute on function public.es_administrativo() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Los módulos administrativos pasan de "solo dirección" a "administrativo"
-- ---------------------------------------------------------------------------
-- Finanzas: gastos y sus comprobantes.
drop policy if exists "gastos: solo direccion" on public.expenses;
drop policy if exists "gastos: administracion" on public.expenses;
create policy "gastos: administracion" on public.expenses
  for all to authenticated
  using (public.es_administrativo())
  with check (public.es_administrativo());

drop policy if exists "comprobantes: solo direccion" on public.expense_receipts;
drop policy if exists "comprobantes: administracion" on public.expense_receipts;
create policy "comprobantes: administracion" on public.expense_receipts
  for all to authenticated
  using (public.es_administrativo())
  with check (public.es_administrativo());

-- Las facturas viven en Storage y llevan su propio juego de policies.
drop policy if exists "facturas storage: ver (direccion)"    on storage.objects;
drop policy if exists "facturas storage: subir (direccion)"  on storage.objects;
drop policy if exists "facturas storage: borrar (direccion)" on storage.objects;
drop policy if exists "facturas storage: ver (administracion)"    on storage.objects;
drop policy if exists "facturas storage: subir (administracion)"  on storage.objects;
drop policy if exists "facturas storage: borrar (administracion)" on storage.objects;

create policy "facturas storage: ver (administracion)" on storage.objects
  for select to authenticated
  using (bucket_id = 'facturas' and public.es_administrativo());

create policy "facturas storage: subir (administracion)" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'facturas' and public.es_administrativo());

create policy "facturas storage: borrar (administracion)" on storage.objects
  for delete to authenticated
  using (bucket_id = 'facturas' and public.es_administrativo());

-- Reportes (de Fresafit y de los clientes de la agencia).
drop policy if exists "reportes: solo direccion"  on public.reportes;
drop policy if exists "reportes: administracion"  on public.reportes;
create policy "reportes: administracion" on public.reportes
  for all to authenticated
  using (public.es_administrativo())
  with check (public.es_administrativo());

-- Agencia y nómina.
do $$
declare
  t text;
begin
  foreach t in array array[
    'agencia_empresas','agencia_asignaciones','agencia_contratos',
    'agencia_ingresos','nomina_empleados','nomina_pagos'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || ': solo direccion', t);
    execute format('drop policy if exists %I on public.%I', t || ': administracion', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.es_administrativo())
         with check (public.es_administrativo())',
      t || ': administracion', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4) El NOMBRE de cada empresa lo puede leer todo el equipo interno
-- ---------------------------------------------------------------------------
-- Las tareas de la agencia se etiquetan con su cliente, y quien las trabaja
-- tiene que ver de quién son. Lo sensible de una empresa no es cómo se llama:
-- son sus contratos y lo que se le cobra, y eso sigue cerrado (`agencia_contratos`,
-- `agencia_ingresos`). Sin esta policy la tarjeta decía "—" en vez del cliente.
--
-- La policy de escritura de arriba es `for all`, que en Postgres también cubre
-- SELECT; por eso el permiso ancho va como policy aparte y solo de lectura: las
-- policies se suman (OR), así que administración conserva todo y el resto del
-- equipo gana únicamente el select.
drop policy if exists "agencia_empresas: leer (interno)" on public.agencia_empresas;
create policy "agencia_empresas: leer (interno)" on public.agencia_empresas
  for select to authenticated
  using (public.es_interno());

-- ---------------------------------------------------------------------------
-- 5) Las tareas se parten por negocio
-- ---------------------------------------------------------------------------
-- Todo lo que ya existía es de Fresafit: el default cubre las filas viejas sin
-- tener que tocarlas.
alter table public.tasks
  add column if not exists espacio    text not null default 'fresafit',
  add column if not exists empresa_id uuid references public.agencia_empresas(id) on delete set null;

alter table public.tasks drop constraint if exists tasks_espacio_check;
alter table public.tasks
  add constraint tasks_espacio_check check (espacio in ('fresafit','agencia'));

-- Una tarea de Fresafit no tiene cliente que la pida: si alguien manda empresa
-- en una tarea de Fresafit, es un error de captura y la BD lo frena.
alter table public.tasks drop constraint if exists tasks_empresa_solo_agencia;
alter table public.tasks
  add constraint tasks_empresa_solo_agencia
  check (espacio = 'agencia' or empresa_id is null);

comment on column public.tasks.espacio is
  'A qué negocio pertenece la tarea: fresafit (la marca) o agencia (clientes que atendemos).';
comment on column public.tasks.empresa_id is
  'Cliente de la agencia al que pertenece la tarea. Null = tarea interna de la agencia o de Fresafit.';

-- Los dos tableros filtran por esta columna en cada carga: sin índice, cada
-- entrada a /tareas era un scan de la tabla entera.
create index if not exists tasks_espacio_idx on public.tasks(espacio) where deleted_at is null;
create index if not exists tasks_empresa_idx on public.tasks(empresa_id) where empresa_id is not null;

notify pgrst, 'reload schema';
