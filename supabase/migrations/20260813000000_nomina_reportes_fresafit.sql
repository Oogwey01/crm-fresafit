-- ============================================================================
-- 20260813000000_nomina_reportes_fresafit.sql — Nómina y reportes también para
-- Fresafit, no solo para la Agencia
-- ----------------------------------------------------------------------------
-- La nómina se construyó dentro del módulo de Agencia, pero cubre a todo el
-- equipo: la mayoría trabaja para Fresafit y no para un cliente. Igual con los
-- reportes: Fresafit también genera los suyos y no tienen empresa que los pida.
--
-- Cambios:
--   1) `agencia_reportes` pasa a llamarse `reportes` y su empresa deja de ser
--      obligatoria: null = es de Fresafit. El nombre viejo mentía sobre su
--      alcance, y la tabla se creó ayer y está vacía, así que renombrarla ahora
--      no cuesta nada y evita arrastrar la confusión.
--   2) `nomina_empleados` ya soportaba empresa_id null = Fresafit; solo se
--      documenta y se siembra al equipo.
--   3) Semilla del equipo con sueldos DE EJEMPLO, marcados como tales en las
--      notas para que nadie los confunda con los reales.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) agencia_reportes → reportes, con empresa opcional
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'agencia_reportes')
     and not exists (select 1 from information_schema.tables
                      where table_schema = 'public' and table_name = 'reportes') then
    alter table public.agencia_reportes rename to reportes;
  end if;
end $$;

alter table public.reportes alter column empresa_id drop not null;

comment on column public.reportes.empresa_id is
  'Cliente de la agencia al que va dirigido. Null = reporte propio de Fresafit.';

-- El índice y la policy conservaron el nombre viejo al renombrar la tabla.
alter index if exists agencia_reportes_empresa_idx rename to reportes_empresa_idx;

drop policy if exists "agencia_reportes: solo direccion" on public.reportes;
drop policy if exists "reportes: solo direccion" on public.reportes;
create policy "reportes: solo direccion" on public.reportes
  for all to authenticated
  using (public.es_admin(auth.uid()))
  with check (public.es_admin(auth.uid()));

grant all on public.reportes to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) La nómina cubre a los dos negocios
-- ---------------------------------------------------------------------------
comment on column public.nomina_empleados.empresa_id is
  'Cliente de la agencia al que se le carga este sueldo. Null = Fresafit.';

-- ---------------------------------------------------------------------------
-- 3) Semilla del equipo de Fresafit
-- ---------------------------------------------------------------------------
-- OJO: los montos son DE EJEMPLO para que la pantalla no nazca vacía. Hay que
-- sustituirlos por los reales; van marcados en las notas para que se note cuáles
-- faltan por capturar.
--
-- Se resuelve el id desde `profiles` por nombre en vez de escribir UUIDs: así la
-- migración sirve igual en cualquier entorno donde el equipo esté sembrado.
insert into public.nomina_empleados
  (profile_id, nombre, puesto, empresa_id, esquema, monto, periodicidad, dia_corte,
   situacion, activo, notas)
select p.id, p.nombre, v.puesto, null, v.esquema, v.monto, v.periodicidad, v.dia_corte,
       v.situacion, true,
       'Monto de ejemplo: falta capturar el real.'
  from (values
    ('Diego Armando Duarte Palacios', 'Dirección general',      'sueldo',     45000, 'mensual',   1,  'contrato'),
    ('René Duarte Palacios',          'Dirección de operaciones','sueldo',    42000, 'mensual',   1,  'contrato'),
    ('Aaron Oviedo',                  'Desarrollo y sistemas',  'honorarios', 35000, 'mensual',   1,  'honorarios'),
    ('Manuel Enrique Barrera Rodríguez','Coordinación de diseño','sueldo',    24000, 'quincenal', 15, 'imss'),
    ('Julio Enrique Zea Silva',       'Coordinación de contenido','sueldo',   23000, 'quincenal', 15, 'imss'),
    ('Juan Pablo Verdugo López',      'Diseño',                 'sueldo',     14000, 'quincenal', 15, 'imss'),
    ('Miguel Ulises Zayas Hernández', 'Diseño',                 'sueldo',     13500, 'quincenal', 15, 'imss'),
    ('Luna Mayela Parra Nava',        'Contenido',              'sueldo',     13000, 'quincenal', 15, 'sin_formalizar'),
    ('Argelia Duarte Villa',          'Contenido',              'sueldo',     12500, 'quincenal', 15, 'sin_formalizar'),
    ('Germán Segura García',          'Logística',              'sueldo',     12000, 'quincenal', 15, 'imss'),
    ('Omar Emiliano Rendón Martínez', 'Logística',              'sueldo',     11500, 'quincenal', 15, 'sin_formalizar')
  ) as v(nombre, puesto, esquema, monto, periodicidad, dia_corte, situacion)
  join public.profiles p on p.nombre = v.nombre
 where not exists (
   select 1 from public.nomina_empleados n
    where n.profile_id = p.id and n.empresa_id is null
 );

-- ---------------------------------------------------------------------------
-- 4) Equipo asignado a cada cliente de la agencia, y su costo
-- ---------------------------------------------------------------------------
-- Bart Jerseys lleva programación; Nutravia es puro TikTok Shop y no. Una misma
-- persona puede tener varios renglones (uno por empresa): se le paga por cada
-- cuenta que atiende, y así el costo de cada contrato es visible.
insert into public.agencia_asignaciones (empresa_id, profile_id, papel, activo)
select e.id, p.id, v.papel, true
  from (values
    ('bart-jerseys', 'Aaron Oviedo',                     'Programación'),
    ('bart-jerseys', 'Manuel Enrique Barrera Rodríguez', 'Diseño y campañas'),
    ('bart-jerseys', 'Julio Enrique Zea Silva',          'Contenido'),
    ('nutravia',     'Manuel Enrique Barrera Rodríguez', 'Diseño y campañas'),
    ('nutravia',     'Julio Enrique Zea Silva',          'Contenido y lives')
  ) as v(slug, nombre, papel)
  join public.agencia_empresas e on e.slug = v.slug
  join public.profiles p on p.nombre = v.nombre
 on conflict (empresa_id, profile_id) do nothing;

insert into public.nomina_empleados
  (profile_id, nombre, puesto, empresa_id, esquema, monto, periodicidad, dia_corte,
   situacion, activo, notas)
select p.id, p.nombre, v.puesto, e.id, v.esquema, v.monto, v.periodicidad, v.dia_corte,
       v.situacion, true,
       'Monto de ejemplo: falta capturar el real.'
  from (values
    ('bart-jerseys', 'Aaron Oviedo',                     'Programación',      'por_proyecto', 18000, 'mensual', 1,  'honorarios'),
    ('bart-jerseys', 'Manuel Enrique Barrera Rodríguez', 'Diseño y campañas', 'honorarios',    9000, 'mensual', 1,  'honorarios'),
    ('bart-jerseys', 'Julio Enrique Zea Silva',          'Contenido',         'honorarios',    8000, 'mensual', 1,  'honorarios'),
    ('nutravia',     'Manuel Enrique Barrera Rodríguez', 'Diseño y campañas', 'honorarios',    9000, 'mensual', 15, 'honorarios'),
    ('nutravia',     'Julio Enrique Zea Silva',          'Contenido y lives', 'honorarios',   10000, 'mensual', 15, 'honorarios')
  ) as v(slug, nombre, puesto, esquema, monto, periodicidad, dia_corte, situacion)
  join public.agencia_empresas e on e.slug = v.slug
  join public.profiles p on p.nombre = v.nombre
 where not exists (
   select 1 from public.nomina_empleados n
    where n.profile_id = p.id and n.empresa_id = e.id
 );

-- El personal de los lives de Nutravia no tiene cuenta en el CRM: se paga con el
-- fondo delegado de 30 000 que el cliente manda para eso.
insert into public.nomina_empleados
  (profile_id, nombre, puesto, empresa_id, esquema, monto, periodicidad, dia_corte,
   situacion, activo, notas)
-- Los null van casteados: en un INSERT … SELECT con VALUES, Postgres no siempre
-- deduce el tipo de la columna destino y se queja de "type unknown".
select null::uuid, v.nombre, v.puesto, e.id, 'destajo', v.monto, 'por_evento', null::integer,
       'sin_formalizar', true,
       'Se paga del fondo delegado de Nutravia. Monto de ejemplo: falta capturar el real.'
  from (values
    ('nutravia', 'Anfitrión de lives 1', 'Lives de TikTok', 6000),
    ('nutravia', 'Anfitrión de lives 2', 'Lives de TikTok', 6000)
  ) as v(slug, nombre, puesto, monto)
  join public.agencia_empresas e on e.slug = v.slug
 where not exists (
   select 1 from public.nomina_empleados n where n.nombre = v.nombre and n.empresa_id = e.id
 );

-- ---------------------------------------------------------------------------
-- 5) Cómo paga la gente, y con qué cupón
-- ---------------------------------------------------------------------------
-- Tienda Nube manda el medio de pago y el cupón DENTRO de cada orden, y el CRM
-- los tiraba. Son dos preguntas que hoy obligan a entrar a su panel: ¿cuánta
-- gente paga a meses? ¿cuánto nos está costando el cupón de 10%?
--
-- Van en `sale_orders` (una fila por orden) y no en `sales` (una por renglón)
-- porque son de la orden: repetirlos por línea inflaría cualquier conteo.
alter table public.sale_orders
  add column if not exists metodo_pago text,
  add column if not exists cupon       text,
  add column if not exists meses       integer;

comment on column public.sale_orders.metodo_pago is
  'Medio de pago que reportó el canal: tarjeta, efectivo, transferencia…';
comment on column public.sale_orders.cupon is
  'Código de cupón aplicado a la orden, si hubo.';
comment on column public.sale_orders.meses is
  'Mensualidades elegidas (1 = pago de contado).';

notify pgrst, 'reload schema';
