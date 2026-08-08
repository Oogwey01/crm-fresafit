-- ============================================================================
-- 20260915000000_portal_tareas.sql — Fase 1b: tareas de ida y vuelta con el
--   cliente, y el nivel de visibilidad de cada una.
-- ----------------------------------------------------------------------------
-- Lo que se pide en el módulo son DOS BANDEJAS: «lo que pedimos» (Fresafit →
-- cliente) y «lo que nos piden» (cliente → Fresafit). No son dos tablas: son la
-- misma tarea mirada desde el lado de quien la creó. `tasks` ya sabe de espacio
-- y de empresa desde 20260819000000, así que lo que falta es (a) decir QUIÉN
-- puede verla y (b) dejar entrar al cliente.
--
-- La pieza central es `visibilidad`:
--
--   privado     solo dirección (y quien la escribió)
--   interno     el equipo de casa — ES EL DEFAULT, y no es casualidad:
--               compartir tiene que ser un acto deliberado. Es más fácil
--               compartir después que arrepentirse de haber expuesto algo.
--   compartido  el equipo y la empresa cliente
--
-- El corte vive en la RLS, no en la pantalla: si un día una consulta se escribe
-- mal o alguien llama a PostgREST a mano, la base sigue devolviendo lo mismo.
--
-- DOS TRAMPAS QUE ESTA MIGRACIÓN ESQUIVA Y QUE HAY QUE SEGUIR ESQUIVANDO:
--
--   1) La policy de SELECT de `tasks` mira COLUMNAS DE LA FILA, nunca
--      `puede_ver_tarea(id)`. Esa función es STABLE y busca la fila dentro de
--      `tasks`: en un INSERT … RETURNING (que es como la app crea tareas) la
--      fila nueva todavía no está en su snapshot y devuelve false. Ver
--      20260907000000_ver_tareas_por_columna.sql, que documenta el día que esto
--      dejó a los miembros sin poder crear tareas.
--
--   2) Las policies se SUMAN (OR). Por eso la de internos empieza con
--      `es_interno()` y la de externos con `es_externo()`: sin ese candado, un
--      contacto del cliente puesto como responsable de una tarea entraría por la
--      rama `responsable_id = auth.uid()` de la política interna y vería una
--      tarea que nadie compartió.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Columnas nuevas
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists visibilidad text not null default 'interno',
  add column if not exists categoria   text;

alter table public.tasks drop constraint if exists tasks_visibilidad_check;
alter table public.tasks
  add constraint tasks_visibilidad_check
  check (visibilidad in ('privado','interno','compartido'));

-- Las categorías del acuerdo con el cliente: sirven para agrupar la bandeja y
-- para decidir qué se exige al cerrar (una tarea de «Documentos» sin archivo
-- adjunto no está resuelta). Nullable: las tareas internas de Fresafit no la
-- necesitan y las 900 que ya existen no se van a re-etiquetar.
alter table public.tasks drop constraint if exists tasks_categoria_check;
alter table public.tasks
  add constraint tasks_categoria_check
  check (categoria is null or categoria in
    ('documentos','accesos','producto','inventario','pago','contenido','legal','otro'));

-- Una tarea compartida sin cliente al que compartírsela no significa nada.
alter table public.tasks drop constraint if exists tasks_compartida_con_empresa;
alter table public.tasks
  add constraint tasks_compartida_con_empresa
  check (visibilidad <> 'compartido' or (espacio = 'agencia' and empresa_id is not null));

comment on column public.tasks.visibilidad is
  'Quién puede ver la tarea: privado (dirección), interno (equipo de casa) o compartido (equipo + empresa cliente). Default interno a propósito: compartir es deliberado.';
comment on column public.tasks.categoria is
  'Categoría del acuerdo con el cliente (documentos, accesos, pago…). Null en las tareas internas de Fresafit. Los requisitos de cierre por categoría viven en CATEGORIAS_TAREA (lib/catalogos.ts).';

-- Urgente: la spec pide un nivel por encima de «alta» que además dispara aviso
-- inmediato en vez de esperar al resumen diario.
alter table public.tasks drop constraint if exists tasks_prioridad_check;
alter table public.tasks
  add constraint tasks_prioridad_check
  check (prioridad in ('baja','media','alta','urgente'));

-- Cancelada: las tareas del módulo NO se borran. La papelera (`deleted_at`)
-- sigue siendo para los errores de captura; «cancelada» es una decisión que se
-- toma y que tiene que quedar a la vista de ambas partes.
alter table public.tasks drop constraint if exists tasks_estado_check;
alter table public.tasks
  add constraint tasks_estado_check
  check (estado in ('por_hacer','en_proceso','atorado','en_revision','hecho','cancelada'));

create or replace function public.etiqueta_estado(e text)
returns text language sql immutable as $$
  select case e
    when 'por_hacer'   then 'Por hacer'
    when 'en_proceso'  then 'En proceso'
    when 'atorado'     then 'Atorado'
    when 'en_revision' then 'En revisión'
    when 'hecho'       then 'Hecho'
    when 'cancelada'   then 'Cancelada'
    else e end;
$$;

-- El portal entra siempre por el mismo camino: su empresa y lo compartido.
create index if not exists tasks_portal_idx
  on public.tasks(empresa_id, visibilidad)
  where espacio = 'agencia' and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2) Quién ve una tarea — la política de lectura, en dos mitades
-- ---------------------------------------------------------------------------
drop policy if exists "tareas: ver segun rol"  on public.tasks;
drop policy if exists "tareas: ver (interno)"  on public.tasks;
drop policy if exists "tareas: ver (externo)"  on public.tasks;

-- El equipo de casa: exactamente las cinco ramas que ya regían (20260907000000),
-- más el corte de lo privado. Ni una regla nueva para quien ya trabajaba aquí.
create policy "tareas: ver (interno)" on public.tasks
  for select to authenticated
  using (
    (select public.es_interno())
    and (
      visibilidad <> 'privado'
      or (select public.es_admin(auth.uid()))
      or created_by = (select auth.uid())
    )
    and (
      (select public.es_gestor())
      or responsable_id = (select auth.uid())
      or created_by     = (select auth.uid())
      or exists (
        select 1 from public.task_assignees a
         where a.task_id = id and a.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.task_shares s
         where s.task_id = id and s.user_id = (select auth.uid())
      )
    )
  );

-- La empresa cliente: su espacio, su empresa, y solo lo compartido. Nada de
-- ramas por responsable o por creador — para el cliente la única llave es que
-- alguien haya decidido compartir.
create policy "tareas: ver (externo)" on public.tasks
  for select to authenticated
  using (
    (select public.es_externo())
    and espacio = 'agencia'
    and empresa_id = (select public.mi_empresa())
    and visibilidad = 'compartido'
    and deleted_at is null
  );

-- ---------------------------------------------------------------------------
-- 3) Quién crea
-- ---------------------------------------------------------------------------
-- El equipo, como hasta hoy.
drop policy if exists "tareas: crear (equipo interno)" on public.tasks;
create policy "tareas: crear (equipo interno)" on public.tasks
  for insert to authenticated
  with check ((select public.es_interno()) and created_by = (select auth.uid()));

-- El cliente: solo su administrador, solo para su empresa, y la tarea nace
-- compartida (si la pide él, es para que la veamos). El colaborador comenta y
-- adjunta, pero no abre pedidos nuevos — es la separación que pidió la spec.
drop policy if exists "tareas: crear (cliente admin)" on public.tasks;
create policy "tareas: crear (cliente admin)" on public.tasks
  for insert to authenticated
  with check (
    (select public.es_externo_admin())
    and created_by = (select auth.uid())
    and espacio = 'agencia'
    and empresa_id = (select public.mi_empresa())
    and visibilidad = 'compartido'
    and deleted_at is null
  );

-- ---------------------------------------------------------------------------
-- 4) Quién edita
-- ---------------------------------------------------------------------------
-- La rama interna es la de 20260903000000 sin cambios, con el candado de rol
-- delante. La externa deja pasar el UPDATE para que el cliente mueva el estado;
-- QUÉ columnas puede tocar lo decide el trigger de abajo (la RLS es por fila,
-- no por columna).
drop policy if exists "tareas: editar (gestor o responsable)" on public.tasks;
create policy "tareas: editar (gestor o responsable)" on public.tasks
  for update to authenticated
  using (
    (
      (select public.es_interno())
      and (
        (select public.es_gestor())
        or created_by = (select auth.uid())
        or public.es_asignado_tarea(id)
      )
    )
    or (
      (select public.es_externo())
      and espacio = 'agencia'
      and empresa_id = (select public.mi_empresa())
      and visibilidad = 'compartido'
      and deleted_at is null
    )
  )
  with check (
    (
      (select public.es_interno())
      and (
        (select public.es_gestor())
        or created_by = (select auth.uid())
        or public.es_asignado_tarea(id)
      )
    )
    or (
      (select public.es_externo())
      and espacio = 'agencia'
      and empresa_id = (select public.mi_empresa())
      and visibilidad = 'compartido'
      and deleted_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- 5) Trigger: qué columnas puede tocar cada quien
-- ---------------------------------------------------------------------------
-- Sigue SIN `security definer`: dentro de una función así `current_user` sería
-- el dueño (postgres) y la primera guarda se cumpliría siempre — el bug que
-- documenta 20260817000000_tareas_coasignados.sql.
create or replace function public.restringir_update_tarea()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or public.es_gestor() then
    return new;
  end if;

  -- ---- La empresa cliente -------------------------------------------------
  -- Va PRIMERO, antes de la rama del creador: un administrador del cliente crea
  -- tareas, y sin este orden podría reetiquetar la suya, cambiarla de empresa o
  -- —lo grave— dejarla en `interno` para que el equipo la siguiera viendo
  -- mientras él la edita a placer. Del lado del cliente solo se mueve el estado.
  if public.es_externo() then
    if not (old.visibilidad = 'compartido'
            and old.espacio = 'agencia'
            and old.empresa_id is not distinct from public.mi_empresa()) then
      raise exception 'Esta tarea no es de tu empresa.';
    end if;

    -- «No cierra las nuestras»: un colaborador no da por terminada ni cancela
    -- una tarea que abrió Fresafit. La suya sí — es suya.
    if new.estado is distinct from old.estado
       and new.estado in ('hecho','cancelada')
       and not public.es_externo_admin()
       and old.created_by is distinct from auth.uid()
    then
      raise exception 'Solo el administrador de tu empresa puede cerrar una tarea que pidió Fresafit.';
    end if;

    new.titulo         := old.titulo;
    new.descripcion    := old.descripcion;
    new.responsable_id := old.responsable_id;
    new.area           := old.area;
    new.prioridad      := old.prioridad;
    new.fecha_limite   := old.fecha_limite;
    new.fecha_inicio   := old.fecha_inicio;
    new.etiquetas      := old.etiquetas;
    new.created_by     := old.created_by;
    new.espacio        := old.espacio;
    new.empresa_id     := old.empresa_id;
    new.visibilidad    := old.visibilidad;
    new.categoria      := old.categoria;
    new.deleted_at     := old.deleted_at;
    return new;
  end if;

  -- ---- Quien creó la tarea ------------------------------------------------
  -- Manda sobre ella: la corrige entera, la comparte y la manda a la papelera.
  -- Lo único que no puede es regalarla ni mudarla de tablero.
  -- El `is not null` importa: hay tareas viejas sin `created_by`, y sin él una
  -- sesión sin auth.uid() (null = null bajo `is not distinct from`) entraría
  -- aquí como si las hubiera creado.
  if old.created_by is not null and old.created_by = auth.uid() then
    new.created_by := old.created_by;
    new.espacio    := old.espacio;
    return new;
  end if;

  if not public.es_asignado_tarea(old.id) then
    raise exception 'Solo quien trabaja la tarea o dirección/coordinación puede modificarla.';
  end if;

  -- ---- Persona asignada que NO la creó ------------------------------------
  -- Se conservan todas las columnas salvo `estado` (y su motivo, que va con él).
  -- `visibilidad` entra en la lista: compartirle algo a un cliente es una
  -- decisión de quien abrió la tarea o de coordinación, no de quien la ejecuta.
  new.titulo         := old.titulo;
  new.descripcion    := old.descripcion;
  new.responsable_id := old.responsable_id;
  new.area           := old.area;
  new.prioridad      := old.prioridad;
  new.fecha_limite   := old.fecha_limite;
  new.etiquetas      := old.etiquetas;
  new.created_by     := old.created_by;
  new.espacio        := old.espacio;
  new.empresa_id     := old.empresa_id;
  new.visibilidad    := old.visibilidad;
  new.categoria      := old.categoria;
  new.deleted_at     := old.deleted_at;
  return new;
end;
$$;

drop trigger if exists tasks_restringir_update on public.tasks;
create trigger tasks_restringir_update
  before update on public.tasks
  for each row execute function public.restringir_update_tarea();

-- ---------------------------------------------------------------------------
-- 6) Las tablas satélite heredan el corte
-- ---------------------------------------------------------------------------
-- Comentarios, subtareas, enlaces, adjuntos, historial y el bucket `adjuntos`
-- de Storage preguntan todos por `puede_ver_tarea()`. Basta con enseñarle las
-- dos reglas nuevas para que el hilo y los archivos de una tarea compartida
-- lleguen al cliente — y para que los de una interna NO lleguen.
--
-- Aquí SÍ vale una función que busca la fila: las satélite preguntan por una
-- tarea que ya existe (ver la nota de 20260907000000).
create or replace function public.puede_ver_tarea(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = tid
      and case
        when public.es_externo() then
          t.espacio = 'agencia'
          and t.empresa_id = public.mi_empresa()
          and t.visibilidad = 'compartido'
          and t.deleted_at is null
        else
          public.es_interno()
          and (
            t.visibilidad <> 'privado'
            or public.es_admin(auth.uid())
            or t.created_by = auth.uid()
          )
          and (
            public.es_gestor()
            or t.responsable_id = auth.uid()
            or t.created_by = auth.uid()
            or exists (select 1 from public.task_assignees a
                        where a.task_id = t.id and a.user_id = auth.uid())
            or exists (select 1 from public.task_shares s
                        where s.task_id = t.id and s.user_id = auth.uid())
          )
      end
  );
$$;

comment on function public.puede_ver_tarea(uuid) is
  'Visibilidad de una tarea, para las tablas satélite (comentarios, subtareas, enlaces, adjuntos, actividad) y para el bucket `adjuntos` de Storage, que preguntan por una tarea YA existente. OJO: no sirve en la política de select de `tasks` misma — es STABLE y busca la fila dentro de tasks, así que en un INSERT … RETURNING la fila nueva aún no está en su snapshot y devuelve false. Ver 20260907000000.';

-- Adjuntar: `puede_contribuir_tarea()` significa «trabaja la tarea», y el
-- cliente nunca va a ser responsable ni acompañante de nada. Se le abre aquí, y
-- solo aquí, porque la spec pide que pueda subir archivos (la constancia fiscal,
-- el logo, el comprobante). Comentar ya le funciona: esa policy va por
-- `puede_ver_tarea`. No se toca `puede_contribuir_tarea` para no darle de paso
-- el checklist y los enlaces, que son herramienta interna.
drop policy if exists "adjuntos: crear" on public.task_attachments;
create policy "adjuntos: crear" on public.task_attachments
  for insert to authenticated
  with check (
    autor = (select auth.uid())
    and (
      public.puede_contribuir_tarea(task_id)
      or ((select public.es_externo()) and public.puede_ver_tarea(task_id))
    )
  );

drop policy if exists "adjuntos storage: subir" on storage.objects;
create policy "adjuntos storage: subir" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'adjuntos'
    and (
      public.puede_contribuir_tarea(((storage.foldername(name))[1])::uuid)
      or (public.es_externo() and public.puede_ver_tarea(((storage.foldername(name))[1])::uuid))
    )
  );

-- ---------------------------------------------------------------------------
-- 7) Todo lo del cliente queda registrado
-- ---------------------------------------------------------------------------
-- El registro de `actividad_empresas` (20260914000000) se llena por trigger y
-- no desde la app: un trigger no se olvida, y lo que se discute meses después
-- es justo lo que a nadie se le ocurrió registrar. Solo las tareas del espacio
-- agencia — el tablero de Fresafit ya tiene su propio historial en
-- `task_activity` y no es evidencia frente a un tercero.
create or replace function public.log_actividad_empresa_tarea()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor  uuid := auth.uid();
  v_nombre text;
begin
  if coalesce(new.espacio, old.espacio) <> 'agencia' then
    return coalesce(new, old);
  end if;

  select nombre into v_nombre from public.profiles where id = v_actor;

  if tg_op = 'INSERT' then
    insert into public.actividad_empresas
      (empresa_id, actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
    values (new.empresa_id, v_actor, v_nombre, 'tarea_creada', 'tarea', new.id,
            jsonb_build_object('titulo', new.titulo, 'visibilidad', new.visibilidad,
                               'categoria', new.categoria, 'prioridad', new.prioridad));
    return new;
  end if;

  if new.estado is distinct from old.estado then
    insert into public.actividad_empresas
      (empresa_id, actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
    values (new.empresa_id, v_actor, v_nombre, 'tarea_estado', 'tarea', new.id,
            jsonb_build_object('titulo', new.titulo, 'antes', old.estado, 'despues', new.estado));
  end if;

  -- El cambio que más importa: el día que algo pasó a ser visible para el
  -- cliente, y quién lo decidió.
  if new.visibilidad is distinct from old.visibilidad then
    insert into public.actividad_empresas
      (empresa_id, actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
    values (new.empresa_id, v_actor, v_nombre, 'visibilidad_cambiada', 'tarea', new.id,
            jsonb_build_object('titulo', new.titulo, 'antes', old.visibilidad, 'despues', new.visibilidad));
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    insert into public.actividad_empresas
      (empresa_id, actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
    values (new.empresa_id, v_actor, v_nombre,
            case when new.deleted_at is null then 'tarea_restaurada' else 'tarea_archivada' end,
            'tarea', new.id, jsonb_build_object('titulo', new.titulo));
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_log_actividad_empresa on public.tasks;
create trigger tasks_log_actividad_empresa
  after insert or update on public.tasks
  for each row execute function public.log_actividad_empresa_tarea();

-- ---------------------------------------------------------------------------
-- 8) Autocomprobación
-- ---------------------------------------------------------------------------
-- Si ya hay algún contacto de cliente dado de alta, se comprueba con él lo que
-- de verdad importa: que NO vea una tarea interna de su propia empresa. Mientras
-- no exista ninguno (el caso al pegar esta migración por primera vez), se avisa
-- y ya — la prueba real la corre /verify con dos sesiones.
do $$
declare
  v_externo  uuid;
  v_empresa  uuid;
  v_interna  uuid;
  v_ve       integer;
  v_error    text;
begin
  select id, empresa_id into v_externo, v_empresa
    from public.profiles where rol = 'externo' order by nombre limit 1;

  if v_externo is null then
    raise notice 'Todavía no hay ningún contacto de cliente: la visibilidad se probará con /verify.';
    return;
  end if;

  begin
    -- Una tarea interna de SU empresa, creada por el sistema para la prueba.
    insert into public.tasks (titulo, created_by, area, prioridad, estado,
                              espacio, empresa_id, visibilidad)
      values ('«prueba de la migración 20260915»', null, 'operaciones', 'baja',
              'por_hacer', 'agencia', v_empresa, 'interno')
      returning id into v_interna;

    perform set_config('request.jwt.claim.sub', v_externo::text, true);
    set local role authenticated;
    select count(*) into v_ve from public.tasks where id = v_interna;
    reset role;

    raise exception 'ok_deshacer';
  exception
    when others then
      v_error := sqlerrm;
      begin reset role; exception when others then null; end;
  end;

  if v_error is distinct from 'ok_deshacer' then
    raise exception 'No se pudo montar la prueba de visibilidad: %', v_error;
  end if;
  if v_ve <> 0 then
    raise exception 'UN CLIENTE ESTÁ VIENDO TAREAS INTERNAS de su empresa. No sigas: revisa las policies de tasks.';
  end if;

  raise notice 'OK — una tarea interna de su propia empresa le queda invisible al cliente.';
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   -- 1. Las dos mitades de la lectura, y que ninguna se quedó sin candado
--   --    de rol (cada `qual` debe empezar por es_interno o es_externo).
--   select policyname, cmd, qual from pg_policies
--    where schemaname='public' and tablename='tasks' and cmd='SELECT';
--
--   -- 2. Nada cambió para el equipo: todas las tareas viejas siguen internas.
--   select visibilidad, count(*) from public.tasks group by 1;
--
--   -- 3. Ver el tablero con los ojos de un contacto del cliente:
--   --    set local role authenticated;
--   --    select set_config('request.jwt.claim.sub','<uuid del externo>',true);
--   --    select id, titulo, visibilidad from public.tasks;
--   --    reset role;
-- ============================================================================
