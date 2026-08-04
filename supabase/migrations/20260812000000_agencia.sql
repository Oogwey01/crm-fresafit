-- ============================================================================
-- 20260812000000_agencia.sql — Fase B: Agencia Fresafit (SOLO DIRECCIÓN)
-- ----------------------------------------------------------------------------
-- Fresafit (la marca) vende cinturones; la Agencia le lleva el marketing y la
-- operación a OTROS negocios y cobra por ello. Son dos negocios distintos que
-- comparten equipo, y el CRM hasta ahora solo conocía el primero.
--
-- La separación es por MÓDULOS, no por una columna `empresa_id` en las 30 tablas
-- que ya existen: inventario, ventas y pedidos siguen siendo de Fresafit y nada
-- de eso cambia. Lo nuevo vive todo aquí:
--
--   agencia_empresas      — los clientes de la agencia (Nutravia, Bart Jerseys)
--   agencia_asignaciones  — quién del equipo trabaja en cada empresa
--   agencia_contratos     — la regla de cobro: fijo + % sobre una base, con corte
--   agencia_ingresos      — lo que la agencia cobra: cortes, migraciones, referidos
--   agencia_reportes      — lo que se le entrega a cada cliente
--   nomina_empleados      — esquema de pago de cada persona (todo el equipo)
--   nomina_pagos          — cada pago hecho o pendiente
--
-- Todo restringido a dirección, igual que Finanzas: es información de sueldos y
-- de contratos de terceros.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Empresas atendidas
-- ---------------------------------------------------------------------------
create table if not exists public.agencia_empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  -- Identificador corto y estable para rutas y reportes ("nutravia").
  slug        text not null unique,
  -- Color con el que se distingue en tablas y gráficas, como los canales.
  color       text not null default '#e84393',
  giro        text,                       -- "Suplementos", "Playeras de fútbol"
  contacto_nombre   text,
  contacto_correo   text,
  contacto_telefono text,
  activa      boolean not null default true,
  inicio      date,                       -- desde cuándo es cliente
  notas       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create index if not exists agencia_empresas_activa_idx on public.agencia_empresas(activa);

drop trigger if exists agencia_empresas_touch on public.agencia_empresas;
create trigger agencia_empresas_touch
  before update on public.agencia_empresas
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Quién del equipo atiende a cada empresa
-- ---------------------------------------------------------------------------
-- Nutravia es puro TikTok Shop y no lleva programación; Bart Jerseys sí. Saber
-- quién entra en qué es lo que permite repartir el costo del equipo entre los
-- contratos en vez de mirarlo como un bloque.
create table if not exists public.agencia_asignaciones (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agencia_empresas(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  papel      text,                        -- "Programación", "Contenido", "Lives"
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, profile_id)
);

create index if not exists agencia_asignaciones_empresa_idx on public.agencia_asignaciones(empresa_id);

-- ---------------------------------------------------------------------------
-- 3) Contratos: la regla de cobro
-- ---------------------------------------------------------------------------
-- Bart Jerseys: 40 000 fijos + 4 % de ventas brutas de Shopify, corte a inicio
-- de mes, descontando cancelaciones y devoluciones.
-- Nutravia: 25 000 fijos + 12 % del GMV de TikTok Shop antes de impuestos, corte
-- el día 15, más 30 000 delegados para pagar al personal de sus lives.
--
-- El fondo delegado NO es ingreso de la agencia: es dinero del cliente que pasa
-- por la agencia para pagar gente. Va en columna aparte para que no infle lo que
-- de verdad se gana.
create table if not exists public.agencia_contratos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.agencia_empresas(id) on delete cascade,
  nombre        text not null default 'Contrato mensual',
  monto_fijo    numeric(12,2) not null default 0 check (monto_fijo >= 0),
  porcentaje    numeric(6,3)  not null default 0 check (porcentaje >= 0 and porcentaje <= 100),
  -- Sobre qué se aplica el porcentaje, con las palabras del acuerdo.
  base_calculo  text not null default 'ventas_brutas'
                check (base_calculo in ('ventas_brutas','gmv_antes_impuestos','ventas_netas','otro')),
  -- De dónde salen esas ventas. Hoy el número se captura a mano en cada corte;
  -- esta columna es lo que permitirá leerlo por API el día que se integre.
  plataforma    text not null default 'otro'
                check (plataforma in ('shopify','tiktok_shop','tienda_nube','mercado_libre','amazon','otro')),
  -- Día del mes en que cierra el periodo (1 = inicio de mes, 15 = quincena).
  dia_corte     integer not null default 1 check (dia_corte between 1 and 28),
  periodicidad  text not null default 'mensual' check (periodicidad in ('mensual','quincenal')),
  fondo_delegado numeric(12,2) not null default 0 check (fondo_delegado >= 0),
  moneda        text not null default 'MXN',
  inicio        date,
  fin           date,
  activo        boolean not null default true,
  notas         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

create index if not exists agencia_contratos_empresa_idx on public.agencia_contratos(empresa_id);
create index if not exists agencia_contratos_activo_idx  on public.agencia_contratos(activo);

drop trigger if exists agencia_contratos_touch on public.agencia_contratos;
create trigger agencia_contratos_touch
  before update on public.agencia_contratos
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4) Ingresos de la agencia
-- ---------------------------------------------------------------------------
-- Una sola tabla para todo lo que entra, porque todo termina en la misma
-- pregunta: cuánto se facturó este mes y qué falta por cobrar.
--   contrato  — el corte de un contrato (fijo + porcentaje sobre las ventas)
--   migracion — mudar a un cliente de plataforma, se cobra aparte
--   referido  — comisión por mandar clientes (contador, Tienda Nube, Kubo, Revie)
--   otro      — lo que no cae en los anteriores
--
-- El desglose se guarda AUNQUE sea calculable: el porcentaje o el fijo pueden
-- renegociarse, y un cobro de marzo tiene que seguir explicándose con las reglas
-- de marzo, no con las de hoy.
create table if not exists public.agencia_ingresos (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid references public.agencia_empresas(id) on delete set null,
  contrato_id  uuid references public.agencia_contratos(id) on delete set null,
  tipo         text not null default 'contrato'
               check (tipo in ('contrato','migracion','referido','otro')),
  concepto     text not null,
  -- Periodo que cubre (solo tiene sentido en los cortes de contrato).
  periodo_desde date,
  periodo_hasta date,
  -- Base capturada y su desglose, congelados al momento del corte.
  ventas_base    numeric(14,2) not null default 0 check (ventas_base >= 0),
  ventas_origen  text not null default 'manual' check (ventas_origen in ('manual','api')),
  ventas_nota    text,                     -- de dónde salió el número
  monto_fijo     numeric(12,2) not null default 0,
  porcentaje     numeric(6,3)  not null default 0,
  monto_variable numeric(12,2) not null default 0,
  -- Dinero del cliente que solo pasa por la agencia (los 30 000 de Nutravia).
  fondo_delegado numeric(12,2) not null default 0,
  -- Lo que se le cobra al cliente = fijo + variable + fondo delegado.
  total          numeric(12,2) not null default 0,
  -- Con quién se comparte, cuando aplica (referidos: "Contador", "Kubo").
  socio          text,
  estado       text not null default 'calculado'
               check (estado in ('calculado','cobrado','pagado','cancelado')),
  cobrado_at   timestamptz,               -- cuándo se le pasó la cuenta
  pagado_at    timestamptz,               -- cuándo entró el dinero
  factura      text,                      -- folio o enlace a la factura
  notas        text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

create index if not exists agencia_ingresos_empresa_idx  on public.agencia_ingresos(empresa_id);
create index if not exists agencia_ingresos_estado_idx   on public.agencia_ingresos(estado);
create index if not exists agencia_ingresos_periodo_idx  on public.agencia_ingresos(periodo_hasta desc);

-- Un contrato no se corta dos veces por el mismo periodo. Sin esto, un doble
-- clic en "calcular corte" duplica la facturación del mes.
create unique index if not exists agencia_ingresos_corte_unico
  on public.agencia_ingresos (contrato_id, periodo_desde, periodo_hasta)
  where contrato_id is not null and periodo_desde is not null;

drop trigger if exists agencia_ingresos_touch on public.agencia_ingresos;
create trigger agencia_ingresos_touch
  before update on public.agencia_ingresos
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5) Reportes entregados al cliente
-- ---------------------------------------------------------------------------
-- Los números salen de Meta y Shopify a mano (automatizarlo es otro trabajo);
-- lo que hace falta ya es el registro de QUÉ se entregó y CUÁNDO, que es lo que
-- se discute cuando un cliente pregunta.
create table if not exists public.agencia_reportes (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.agencia_empresas(id) on delete cascade,
  titulo        text not null,
  periodo_desde date,
  periodo_hasta date,
  resumen       text,                     -- los puntos que se le contaron
  url           text,                     -- presentación, carpeta, video
  entregado_at  timestamptz,              -- null = todavía se está armando
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

create index if not exists agencia_reportes_empresa_idx on public.agencia_reportes(empresa_id, periodo_hasta desc);

drop trigger if exists agencia_reportes_touch on public.agencia_reportes;
create trigger agencia_reportes_touch
  before update on public.agencia_reportes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6) Nómina — todo el equipo, no solo la agencia
-- ---------------------------------------------------------------------------
-- Hoy la nómina solo existe como una categoría de gasto: un renglón "nómina" al
-- mes sin decir de quién. Esto es lo que Armando pedía poder contestar: quién
-- cobra qué, cada cuándo, y bajo qué figura (IMSS, contrato, o nada todavía).
--
-- `profile_id` liga a la cuenta del CRM cuando la persona tiene una; el personal
-- de los lives de Nutravia no la tiene, y por eso el nombre va aparte.
-- `empresa_id` null = Fresafit; con valor = se carga a esa empresa.
create table if not exists public.nomina_empleados (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references public.profiles(id) on delete set null,
  nombre       text not null,
  puesto       text,
  empresa_id   uuid references public.agencia_empresas(id) on delete set null,
  esquema      text not null default 'sueldo'
               check (esquema in ('sueldo','honorarios','por_proyecto','comision','destajo')),
  monto        numeric(12,2) not null default 0 check (monto >= 0),
  periodicidad text not null default 'quincenal'
               check (periodicidad in ('semanal','quincenal','mensual','por_evento')),
  dia_corte    integer check (dia_corte between 1 and 31),
  -- Bajo qué figura está: es la pregunta que hay que poder contestar de un
  -- vistazo cuando se regulariza al equipo.
  situacion    text not null default 'sin_formalizar'
               check (situacion in ('imss','contrato','honorarios','sin_formalizar')),
  activo       boolean not null default true,
  inicio       date,
  fin          date,
  notas        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

create index if not exists nomina_empleados_activo_idx  on public.nomina_empleados(activo);
create index if not exists nomina_empleados_empresa_idx on public.nomina_empleados(empresa_id);

drop trigger if exists nomina_empleados_touch on public.nomina_empleados;
create trigger nomina_empleados_touch
  before update on public.nomina_empleados
  for each row execute function public.touch_updated_at();

create table if not exists public.nomina_pagos (
  id            uuid primary key default gen_random_uuid(),
  empleado_id   uuid not null references public.nomina_empleados(id) on delete cascade,
  periodo_desde date,
  periodo_hasta date,
  monto         numeric(12,2) not null check (monto >= 0),
  estado        text not null default 'pendiente' check (estado in ('pendiente','pagado')),
  fecha_pago    date,
  metodo        text,                     -- transferencia, efectivo…
  comprobante   text,                     -- folio o enlace
  notas         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

create index if not exists nomina_pagos_empleado_idx on public.nomina_pagos(empleado_id, periodo_hasta desc);
create index if not exists nomina_pagos_estado_idx   on public.nomina_pagos(estado);

-- Un empleado no se paga dos veces el mismo periodo.
create unique index if not exists nomina_pagos_periodo_unico
  on public.nomina_pagos (empleado_id, periodo_desde, periodo_hasta)
  where periodo_desde is not null;

drop trigger if exists nomina_pagos_touch on public.nomina_pagos;
create trigger nomina_pagos_touch
  before update on public.nomina_pagos
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 7) RLS — todo solo para dirección, igual que Finanzas
-- ---------------------------------------------------------------------------
-- Son contratos de terceros y sueldos del equipo: el módulo entero es tan
-- sensible como los gastos. Sin policy para el resto, RLS deniega por defecto.
grant all on
  public.agencia_empresas, public.agencia_asignaciones, public.agencia_contratos,
  public.agencia_ingresos, public.agencia_reportes,
  public.nomina_empleados, public.nomina_pagos
  to authenticated, service_role;

alter table public.agencia_empresas     enable row level security;
alter table public.agencia_asignaciones enable row level security;
alter table public.agencia_contratos    enable row level security;
alter table public.agencia_ingresos     enable row level security;
alter table public.agencia_reportes     enable row level security;
alter table public.nomina_empleados     enable row level security;
alter table public.nomina_pagos         enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'agencia_empresas','agencia_asignaciones','agencia_contratos',
    'agencia_ingresos','agencia_reportes','nomina_empleados','nomina_pagos'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || ': solo direccion', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.es_admin(auth.uid()))
         with check (public.es_admin(auth.uid()))',
      t || ': solo direccion', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8) Los dos clientes actuales, con sus reglas tal como se acordaron
-- ---------------------------------------------------------------------------
-- Se siembran para no tener que capturarlos a mano, y con `on conflict do
-- nothing` para que volver a correr la migración no pise lo que ya se editó.
insert into public.agencia_empresas (nombre, slug, color, giro, activa)
values
  ('Nutravia',     'nutravia',     '#00b894', 'Suplementos',           true),
  ('Bart Jerseys', 'bart-jerseys', '#0984e3', 'Playeras de fútbol',    true)
on conflict (slug) do nothing;

insert into public.agencia_contratos
  (empresa_id, nombre, monto_fijo, porcentaje, base_calculo, plataforma, dia_corte,
   periodicidad, fondo_delegado, notas)
select e.id, 'Contrato mensual', 25000, 12, 'gmv_antes_impuestos', 'tiktok_shop', 15,
       'mensual', 30000,
       'Los 30 000 son dinero de Nutravia para pagar al personal de sus lives: pasan por la agencia, no son ingreso.'
  from public.agencia_empresas e
 where e.slug = 'nutravia'
   and not exists (select 1 from public.agencia_contratos c where c.empresa_id = e.id);

insert into public.agencia_contratos
  (empresa_id, nombre, monto_fijo, porcentaje, base_calculo, plataforma, dia_corte,
   periodicidad, fondo_delegado, notas)
select e.id, 'Contrato mensual', 40000, 4, 'ventas_brutas', 'shopify', 1,
       'mensual', 0,
       'Del bruto se descuentan cancelaciones, devoluciones y pedidos que nunca se aprobaron.'
  from public.agencia_empresas e
 where e.slug = 'bart-jerseys'
   and not exists (select 1 from public.agencia_contratos c where c.empresa_id = e.id);

notify pgrst, 'reload schema';
