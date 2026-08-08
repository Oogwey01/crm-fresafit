-- ============================================================================
-- 20260917000000_portal_avance.sql — Fase 3: el avance del proyecto
-- ----------------------------------------------------------------------------
-- La bitácora. Existe para contestar «¿en qué vamos?» sin que el cliente tenga
-- que preguntarlo — y sin que nosotros tengamos que reconstruirlo de memoria
-- cada vez que lo pregunta.
--
-- Cuatro cosas, y cada una responde algo distinto:
--
--   empresa_avance      dónde estamos AHORA. Una frase, editable. Es lo primero
--                       que se lee al entrar y casi siempre lo único que hace
--                       falta.
--   empresa_eventos     qué viene: el live del viernes, el corte del día 15.
--   empresa_bitacora    qué se ha ido haciendo, en orden. Es el respaldo.
--   empresa_incidencias qué está FRENANDO, y —la columna que importa— de qué
--                       lado está la pelota. Un bloqueo sin dueño es un bloqueo
--                       que nadie mueve.
--
-- Los «pendientes de cada lado» que pide la spec NO son tabla: son las tareas
-- compartidas abiertas, agrupadas por quién las pidió. Duplicarlas aquí sería
-- tener dos listas que se contradicen a la semana.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Estado actual — una fila por empresa
-- ---------------------------------------------------------------------------
-- Sin nivel de visibilidad: el estado del proyecto es lo que el cliente entra a
-- ver. Si algo no se le puede contar, no va aquí — va en una tarea interna.
create table if not exists public.empresa_avance (
  empresa_id      uuid primary key references public.agencia_empresas(id) on delete cascade,
  estado_actual   text,
  actualizado_por uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now()
);

comment on table public.empresa_avance is
  'El resumen de en qué etapa va el proyecto de cada cliente. Siempre visible para esa empresa: lo que no se le pueda contar no va aquí.';

-- ---------------------------------------------------------------------------
-- 2) Próximos eventos
-- ---------------------------------------------------------------------------
create table if not exists public.empresa_eventos (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.agencia_empresas(id) on delete cascade,
  titulo       text not null,
  descripcion  text,
  -- Con hora: un live y una junta se agendan a una hora, no a un día.
  inicia_en    timestamptz not null,
  visibilidad  text not null default 'interno'
               check (visibilidad in ('privado','interno','compartido')),
  archivado_at timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

create index if not exists empresa_eventos_idx
  on public.empresa_eventos(empresa_id, inicia_en) where archivado_at is null;

drop trigger if exists empresa_eventos_touch on public.empresa_eventos;
create trigger empresa_eventos_touch
  before update on public.empresa_eventos
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3) Bitácora de avance
-- ---------------------------------------------------------------------------
-- `fecha` es del HECHO, no del registro: se apunta el lunes lo que pasó el
-- viernes, y el reporte de periodo tiene que ordenarlo por cuándo ocurrió.
create table if not exists public.empresa_bitacora (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.agencia_empresas(id) on delete cascade,
  fecha        date not null default current_date,
  titulo       text not null,
  descripcion  text,
  visibilidad  text not null default 'interno'
               check (visibilidad in ('privado','interno','compartido')),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

create index if not exists empresa_bitacora_idx
  on public.empresa_bitacora(empresa_id, fecha desc, id);

drop trigger if exists empresa_bitacora_touch on public.empresa_bitacora;
create trigger empresa_bitacora_touch
  before update on public.empresa_bitacora
  for each row execute function public.touch_updated_at();

-- Capturas y evidencias de una entrada. Van al bucket `empresas` ya creado, bajo
-- `bitacora/<entrada_id>/…`, y por eso NO pueden colgar de las policies de
-- documento: el primer segmento de esa ruta es la palabra «bitacora», no un id.
-- Se les da su propio juego, con su propia función.
create table if not exists public.empresa_bitacora_adjuntos (
  id            uuid primary key default gen_random_uuid(),
  entrada_id    uuid not null references public.empresa_bitacora(id) on delete cascade,
  storage_path  text not null,
  nombre        text not null,
  mime          text,
  subido_por    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists empresa_bitacora_adjuntos_idx
  on public.empresa_bitacora_adjuntos(entrada_id);

-- ---------------------------------------------------------------------------
-- 4) Incidencias y bloqueos
-- ---------------------------------------------------------------------------
-- `desbloquea` es LA columna de esta tabla. Un bloqueo sin dueño se queda
-- semanas: escrito, cada parte ve lo suyo en su pantalla y deja de haber
-- discusión sobre a quién le tocaba.
create table if not exists public.empresa_incidencias (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.agencia_empresas(id) on delete cascade,
  titulo       text not null,
  descripcion  text,
  desbloquea   text not null check (desbloquea in ('fresafit','cliente')),
  -- Qué se está deteniendo por esto. Es lo que convierte «falta el acceso» en
  -- «sin el acceso no podemos publicar», que es lo que mueve a alguien.
  impacto      text,
  detectada_en date not null default current_date,
  estado       text not null default 'abierta'
               check (estado in ('abierta','en_resolucion','resuelta')),
  resuelta_en  date,
  visibilidad  text not null default 'interno'
               check (visibilidad in ('privado','interno','compartido')),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

create index if not exists empresa_incidencias_idx
  on public.empresa_incidencias(empresa_id, estado, detectada_en desc);

drop trigger if exists empresa_incidencias_touch on public.empresa_incidencias;
create trigger empresa_incidencias_touch
  before update on public.empresa_incidencias
  for each row execute function public.touch_updated_at();

-- Al resolverla se sella la fecha sola: pedirla a mano es pedir un dato que
-- siempre es «hoy» y que la mitad de las veces se queda vacío.
create or replace function public.sellar_incidencia_resuelta()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.estado = 'resuelta' and old.estado <> 'resuelta' then
    new.resuelta_en := coalesce(new.resuelta_en, current_date);
  elsif new.estado <> 'resuelta' then
    new.resuelta_en := null;
  end if;
  return new;
end;
$$;

drop trigger if exists empresa_incidencias_sellar on public.empresa_incidencias;
create trigger empresa_incidencias_sellar
  before update on public.empresa_incidencias
  for each row execute function public.sellar_incidencia_resuelta();

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------
grant all on
  public.empresa_avance, public.empresa_eventos, public.empresa_bitacora,
  public.empresa_bitacora_adjuntos, public.empresa_incidencias
  to authenticated, service_role;

alter table public.empresa_avance             enable row level security;
alter table public.empresa_eventos            enable row level security;
alter table public.empresa_bitacora           enable row level security;
alter table public.empresa_bitacora_adjuntos  enable row level security;
alter table public.empresa_incidencias        enable row level security;

-- El estado actual: lo lee el equipo y SU empresa; lo escribe el equipo.
drop policy if exists "avance: ver" on public.empresa_avance;
create policy "avance: ver" on public.empresa_avance
  for select to authenticated
  using (
    (select public.es_interno())
    or ((select public.es_externo()) and empresa_id = (select public.mi_empresa()))
  );

drop policy if exists "avance: escribir (interno)" on public.empresa_avance;
create policy "avance: escribir (interno)" on public.empresa_avance
  for all to authenticated
  using ((select public.es_interno()))
  with check ((select public.es_interno()));

-- Eventos, bitácora e incidencias: el mismo par de policies de lectura que
-- tareas y documentos —cada una con su candado de rol, porque se suman— y
-- escritura del equipo. Se generan en bucle para que las tres digan LO MISMO:
-- escritas a mano, la tercera acaba divergiendo.
do $$
declare
  t text;
begin
  foreach t in array array['empresa_eventos','empresa_bitacora','empresa_incidencias'] loop
    execute format('drop policy if exists %I on public.%I', t || ': ver (interno)', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (
           (select public.es_interno())
           and (
             visibilidad <> ''privado''
             or (select public.es_admin(auth.uid()))
             or created_by = (select auth.uid())
           )
         )', t || ': ver (interno)', t);

    execute format('drop policy if exists %I on public.%I', t || ': ver (externo)', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (
           (select public.es_externo())
           and empresa_id = (select public.mi_empresa())
           and visibilidad = ''compartido''
         )', t || ': ver (externo)', t);

    execute format('drop policy if exists %I on public.%I', t || ': escribir (interno)', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using ((select public.es_interno()))
         with check ((select public.es_interno()))',
      t || ': escribir (interno)', t);
  end loop;
end $$;

-- La excepción: el cliente mueve a «en resolución» las incidencias que están en
-- SU cancha. Es la mitad del valor de esa columna — poder decir «ya lo estoy
-- viendo» sin escribir un correo. No las cierra: darlas por resueltas es de
-- quien puede comprobar que se desbloqueó.
drop policy if exists "incidencias: mover (cliente)" on public.empresa_incidencias;
create policy "incidencias: mover (cliente)" on public.empresa_incidencias
  for update to authenticated
  using (
    (select public.es_externo())
    and empresa_id = (select public.mi_empresa())
    and visibilidad = 'compartido'
    and desbloquea = 'cliente'
  )
  with check (
    (select public.es_externo())
    and empresa_id = (select public.mi_empresa())
    and visibilidad = 'compartido'
    and desbloquea = 'cliente'
  );

-- Y el trigger que acota QUÉ puede tocar (la RLS es por fila, no por columna).
create or replace function public.restringir_update_incidencia()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or not public.es_externo() then
    return new;
  end if;

  if new.estado not in ('abierta','en_resolucion') then
    raise exception 'Dar una incidencia por resuelta es de Fresafit: avísanos por el comentario y la cerramos.';
  end if;

  -- Del lado del cliente solo se mueve el estado; todo lo demás se conserva.
  new.titulo       := old.titulo;
  new.descripcion  := old.descripcion;
  new.desbloquea   := old.desbloquea;
  new.impacto      := old.impacto;
  new.detectada_en := old.detectada_en;
  new.visibilidad  := old.visibilidad;
  new.empresa_id   := old.empresa_id;
  new.created_by   := old.created_by;
  return new;
end;
$$;

drop trigger if exists empresa_incidencias_restringir on public.empresa_incidencias;
create trigger empresa_incidencias_restringir
  before update on public.empresa_incidencias
  for each row execute function public.restringir_update_incidencia();

-- Adjuntos de bitácora: heredan de su entrada.
create or replace function public.puede_ver_bitacora(bid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.empresa_bitacora b
    where b.id = bid
      and case
        when public.es_externo() then
          b.empresa_id = public.mi_empresa() and b.visibilidad = 'compartido'
        else
          public.es_interno()
          and (b.visibilidad <> 'privado' or public.es_admin(auth.uid()) or b.created_by = auth.uid())
      end
  );
$$;

grant execute on function public.puede_ver_bitacora(uuid) to authenticated;

drop policy if exists "bitacora adjuntos: ver" on public.empresa_bitacora_adjuntos;
create policy "bitacora adjuntos: ver" on public.empresa_bitacora_adjuntos
  for select to authenticated using (public.puede_ver_bitacora(entrada_id));

drop policy if exists "bitacora adjuntos: agregar (interno)" on public.empresa_bitacora_adjuntos;
create policy "bitacora adjuntos: agregar (interno)" on public.empresa_bitacora_adjuntos
  for insert to authenticated
  with check ((select public.es_interno()) and public.puede_ver_bitacora(entrada_id));

-- Storage: la carpeta `bitacora/<entrada_id>/…` del bucket `empresas`. El id va
-- en el SEGUNDO segmento, no en el primero, así que necesita su propia policy —
-- las de documento miran el primero y aquí encontrarían la palabra «bitacora».
drop policy if exists "bitacora storage: ver" on storage.objects;
create policy "bitacora storage: ver" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'empresas'
    and (storage.foldername(name))[1] = 'bitacora'
    and public.puede_ver_bitacora(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists "bitacora storage: subir" on storage.objects;
create policy "bitacora storage: subir" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'empresas'
    and (storage.foldername(name))[1] = 'bitacora'
    and public.es_interno()
    and public.puede_ver_bitacora(((storage.foldername(name))[2])::uuid)
  );

-- OJO: la policy "empresas storage: ver" de 20260916000000 intenta convertir el
-- primer segmento a uuid, y aquí ese segmento es la palabra 'bitacora'. Se
-- reescribe para que descarte esas rutas ANTES de intentar el cast: sin esto,
-- listar el bucket revienta con «invalid input syntax for type uuid».
drop policy if exists "empresas storage: ver" on storage.objects;
create policy "empresas storage: ver" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'empresas'
    and (storage.foldername(name))[1] <> 'bitacora'
    and public.puede_ver_documento(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "empresas storage: subir" on storage.objects;
create policy "empresas storage: subir" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'empresas'
    and (storage.foldername(name))[1] <> 'bitacora'
    and public.puede_ver_documento(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- 6) Registro
-- ---------------------------------------------------------------------------
-- Una entrada de bitácora y una incidencia son afirmaciones sobre lo que pasó:
-- van al expediente igual que las tareas y los documentos.
create or replace function public.log_actividad_avance()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor  uuid := auth.uid();
  v_nombre text;
  v_accion text;
  v_titulo text := coalesce(new.titulo, old.titulo);
begin
  select nombre into v_nombre from public.profiles where id = v_actor;

  if tg_op = 'INSERT' then
    v_accion := case tg_table_name
      when 'empresa_bitacora'    then 'bitacora_creada'
      when 'empresa_incidencias' then 'incidencia_creada'
      else 'evento_creado' end;
  elsif tg_table_name = 'empresa_incidencias' and new.estado is distinct from old.estado then
    v_accion := 'incidencia_estado';
  elsif new.visibilidad is distinct from old.visibilidad then
    v_accion := 'visibilidad_cambiada';
  else
    return new;
  end if;

  insert into public.actividad_empresas
    (empresa_id, actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
  values (new.empresa_id, v_actor, v_nombre, v_accion,
          replace(tg_table_name, 'empresa_', ''), new.id,
          jsonb_build_object(
            'titulo', v_titulo,
            'estado', case when tg_table_name = 'empresa_incidencias' then new.estado end,
            'visibilidad', new.visibilidad));
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['empresa_eventos','empresa_bitacora','empresa_incidencias'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_log', t);
    execute format(
      'create trigger %I after insert or update on public.%I
         for each row execute function public.log_actividad_avance()',
      t || '_log', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7) Una fila de avance por cada empresa que ya existe
-- ---------------------------------------------------------------------------
-- Así la pantalla nunca aparece vacía sin saber si es que no hay nada o que la
-- consulta falló.
insert into public.empresa_avance (empresa_id, estado_actual)
select e.id, null from public.agencia_empresas e
on conflict (empresa_id) do nothing;

-- ---------------------------------------------------------------------------
-- 8) Autocomprobación
-- ---------------------------------------------------------------------------
do $$
declare
  v_faltan int;
begin
  -- Las tres tablas con visibilidad tienen que tener SUS DOS policies de
  -- lectura: si falta la de externo, el cliente no ve nada; si falta la de
  -- interno, el equipo tampoco.
  select 3 * 2 - count(*) into v_faltan
    from pg_policies
   where schemaname = 'public'
     and tablename in ('empresa_eventos','empresa_bitacora','empresa_incidencias')
     and cmd = 'SELECT';

  if v_faltan <> 0 then
    raise exception 'Faltan % policies de lectura en las tablas de avance.', v_faltan;
  end if;

  raise notice 'OK — avance, eventos, bitácora e incidencias con sus dos lecturas.';
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   -- Una fila de avance por empresa:
--   select e.nombre, a.estado_actual from public.agencia_empresas e
--     left join public.empresa_avance a on a.empresa_id = e.id;
--
--   -- Que el bucket no se rompa al mezclar rutas de documento y de bitácora:
--   select name from storage.objects where bucket_id = 'empresas' limit 5;
-- ============================================================================
