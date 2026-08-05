-- ============================================================================
-- 20260821000000_bodega.sql — El cuaderno de bodega, dentro del CRM
-- ----------------------------------------------------------------------------
-- Digitaliza el Google Sheet «FRESA FIT - Bodega», que es donde de verdad vive
-- la operación diaria y que hoy corre en paralelo al CRM:
--
--   * recepciones_bodega / recepcion_items — la carga de mercancía con sus
--     estados TRAER → CARGADO → CHECADO → DESCONTADO (en la hoja eran los
--     valores 0/1/2/3 de la columna de chequeo).
--   * conjuntos / conjunto_componentes — los bundles (un conjunto = cinturón +
--     muñequeras + straps). El CRM no modelaba que un SKU se arme de otros.
--   * personalizados — los cinturones bordados/sublimados en proceso, que hoy
--     Emiliano lleva a mano y nadie más ve.
--   * envios_full / envio_full_cajas / envio_full_items — los envíos "full" a
--     Amazon y Mercado Libre, con sus cajas y su checklist.
--   * insumos / insumo_movimientos / insumo_permisos — lo que se consume en
--     bodega. Aquí está la jerarquía que pidió René: TODO el equipo interno ve
--     el inventario de insumos, pero solo quien tenga permiso puede descontar.
--
-- El descuento de stock es SIEMPRE local (products.stock + stock_log): el CRM
-- sigue siendo solo-lectura frente a Tienda Nube, Mercado Libre y TikTok.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Recepción de mercancía.
--    `pedido_proveedor_id` liga la carga con el pedido que llegó: sirve para
--    rastrear y, sobre todo, para avisar en la UI del riesgo de contar dos
--    veces (recibir el pedido "sumando stock" Y descontar la recepción).
-- ---------------------------------------------------------------------------
create table if not exists public.recepciones_bodega (
  id                  uuid primary key default gen_random_uuid(),
  titulo              text not null,
  canal               text not null default 'tienda_nube'
                        check (canal in ('tienda_nube','mercado_libre')),
  estado              text not null default 'abierta' check (estado in ('abierta','cerrada')),
  pedido_proveedor_id uuid references public.supplier_orders(id) on delete set null,
  notas               text,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  cerrada_en          timestamptz
);
create index if not exists recepciones_estado_idx on public.recepciones_bodega(estado, created_at desc);

-- Un renglón por SKU de la carga. La CANTIDAD CONSOLIDADA de la hoja NO se
-- guarda: es una suma por `sku_consolidado` que la app deriva al pintar.
-- Guardarla sería invitar a que se descuadre con las unidades.
create table if not exists public.recepcion_items (
  id                      uuid primary key default gen_random_uuid(),
  recepcion_id            uuid not null references public.recepciones_bodega(id) on delete cascade,
  sku                     text not null,
  producto_id             uuid references public.products(id) on delete set null,
  unidades_no_procesadas  int not null default 0 check (unidades_no_procesadas >= 0),
  sku_consolidado         text,
  categoria               text,
  producto_nombre         text,
  talla                   text,
  estado                  text not null default 'traer'
                            check (estado in ('traer','cargado','checado','descontado')),
  descontado_en           timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists recepcion_items_recepcion_idx on public.recepcion_items(recepcion_id);
create index if not exists recepcion_items_estado_idx    on public.recepcion_items(estado);

-- Descontar un renglón: suma sus unidades al stock local y deja rastro.
-- Idempotente a propósito: volver a picar el botón (o dos personas a la vez en
-- el piso) no puede sumar dos veces.
create or replace function public.descontar_recepcion(iid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  fila public.recepcion_items;
  antes int;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede mover el inventario.';
  end if;

  -- El lock evita la carrera de dos descuentos simultáneos del mismo renglón.
  select * into fila from public.recepcion_items where id = iid for update;
  if not found then
    raise exception 'Ese renglón de recepción ya no existe.';
  end if;
  if fila.estado = 'descontado' then
    return;  -- ya se aplicó; no-op
  end if;

  if fila.producto_id is not null and fila.unidades_no_procesadas > 0 then
    select stock into antes from public.products where id = fila.producto_id for update;
    update public.products
       set stock = stock + fila.unidades_no_procesadas
     where id = fila.producto_id;
    insert into public.stock_log (producto_id, canal, origen, stock_anterior, stock_nuevo)
      values (fila.producto_id, 'crm', 'recepcion_bodega', antes,
              antes + fila.unidades_no_procesadas);
  end if;

  update public.recepcion_items
     set estado = 'descontado', descontado_en = now(), updated_at = now()
   where id = iid;
end;
$$;
grant execute on function public.descontar_recepcion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Conjuntos (bundles). Genérico a n componentes aunque hoy siempre sean tres
--    (cinturón + muñequeras + straps): no cuesta nada y aguanta lo que venga.
-- ---------------------------------------------------------------------------
create table if not exists public.conjuntos (
  id          uuid primary key default gen_random_uuid(),
  sku         text not null,
  titulo      text not null,
  categoria   text,
  talla       text,
  activo      boolean not null default true,
  notas       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists conjuntos_sku_idx on public.conjuntos (upper(sku));

create table if not exists public.conjunto_componentes (
  id             uuid primary key default gen_random_uuid(),
  conjunto_id    uuid not null references public.conjuntos(id) on delete cascade,
  producto_id    uuid references public.products(id) on delete set null,
  sku_componente text not null,
  rol            text check (rol in ('cinturon','munequeras','straps','otro')),
  cantidad       int not null default 1 check (cantidad > 0),
  unique (conjunto_id, sku_componente)
);
create index if not exists conjunto_comp_conjunto_idx on public.conjunto_componentes(conjunto_id);

-- ---------------------------------------------------------------------------
-- 3. Personalizados en proceso (lo que pidió René para Emiliano).
--    `fecha_produccion` = el día en que el diseño quedó aprobado por el cliente
--    y se mandó al proveedor: es el dato que hoy nadie sabe dónde buscar.
--    Todo es captura manual, incluida la foto del diseño aprobado.
-- ---------------------------------------------------------------------------
create table if not exists public.personalizados (
  id               uuid primary key default gen_random_uuid(),
  cliente          text not null,
  tipo             text check (tipo in ('bordado','sublimado','otro')),
  modelo           text check (modelo in ('sevilla','powerlift','otro')),
  talla            text,
  no_venta         text,
  canal            text check (canal in ('tienda_nube','mercado_libre','tiktok_shop','otro')),
  fecha_compra     date,
  fecha_produccion date,
  url              text,
  foto_path        text,   -- ruta en el bucket `personalizados` (diseño aprobado)
  estado           text not null default 'diseno'
                     check (estado in ('diseno','produccion','listo','entregado')),
  notas            text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists personalizados_estado_idx on public.personalizados(estado, fecha_compra desc);

-- ---------------------------------------------------------------------------
-- 4. Envíos "full" a Amazon / Mercado Libre.
--    `asin` es solo texto: el CRM no habla con Amazon, pero la caja se arma con
--    ese dato a la vista y sin él la hoja no servía.
-- ---------------------------------------------------------------------------
create table if not exists public.envios_full (
  id          uuid primary key default gen_random_uuid(),
  destino     text not null check (destino in ('amazon','mercado_libre')),
  nombre      text not null,
  estado      text not null default 'preparando'
                check (estado in ('preparando','enviado','cancelado')),
  fecha_envio date,
  notas       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.envio_full_cajas (
  id          uuid primary key default gen_random_uuid(),
  envio_id    uuid not null references public.envios_full(id) on delete cascade,
  numero      int not null,
  dimensiones text,
  peso_kg     numeric(6,2) check (peso_kg >= 0),
  unique (envio_id, numero)
);

create table if not exists public.envio_full_items (
  id          uuid primary key default gen_random_uuid(),
  caja_id     uuid not null references public.envio_full_cajas(id) on delete cascade,
  producto_id uuid references public.products(id) on delete set null,
  sku         text not null,
  asin        text,
  cantidad    int not null check (cantidad > 0),
  empaquetado boolean not null default false,
  cancelado   boolean not null default false,
  descontado  boolean not null default false
);
create index if not exists envio_full_items_caja_idx on public.envio_full_items(caja_id);

-- ---------------------------------------------------------------------------
-- 5. Insumos, con la jerarquía de René: todos ven, algunos descuentan.
--    El stock del insumo NO se edita a mano: siempre pasa por mover_insumo(),
--    que valida el permiso y deja el movimiento registrado.
-- ---------------------------------------------------------------------------
create table if not exists public.insumos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  unidad     text not null default 'pieza',
  stock      numeric(12,2) not null default 0,
  minimo     numeric(12,2) not null default 0 check (minimo >= 0),
  notas      text,
  activo     boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.insumo_movimientos (
  id         uuid primary key default gen_random_uuid(),
  insumo_id  uuid not null references public.insumos(id) on delete cascade,
  tipo       text not null check (tipo in ('entrada','salida','ajuste')),
  cantidad   numeric(12,2) not null check (cantidad >= 0),
  -- Stock que quedó tras el movimiento: el histórico se lee sin recalcular.
  stock_resultante numeric(12,2),
  motivo     text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists insumo_mov_insumo_idx on public.insumo_movimientos(insumo_id, created_at desc);

-- Quién puede descontar. Dirección y administración pueden siempre (no hace
-- falta darles de alta aquí); esta tabla es para habilitar a alguien más —el
-- caso concreto: René descuenta, Germán solo observa—.
create table if not exists public.insumo_permisos (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,
  puede_descontar boolean not null default true,
  otorgado_por    uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create or replace function public.puede_mover_insumos()
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_administrativo()
      or exists (
           select 1 from public.insumo_permisos
            where profile_id = auth.uid() and puede_descontar
         );
$$;
grant execute on function public.puede_mover_insumos() to authenticated;

-- Movimiento de insumo: valida el permiso, ajusta el stock y registra. Es la
-- única vía de escritura del stock, para que no haya dos verdades.
create or replace function public.mover_insumo(
  iid uuid, p_tipo text, p_cantidad numeric, p_motivo text
)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  actual numeric;
  nuevo  numeric;
begin
  if not public.puede_mover_insumos() then
    raise exception 'No tienes permiso para mover el inventario de insumos.';
  end if;
  if p_tipo not in ('entrada','salida','ajuste') then
    raise exception 'Tipo de movimiento inválido.';
  end if;
  if p_cantidad is null or p_cantidad < 0 then
    raise exception 'La cantidad no puede ser negativa.';
  end if;

  select stock into actual from public.insumos where id = iid for update;
  if not found then
    raise exception 'Ese insumo ya no existe.';
  end if;

  nuevo := case p_tipo
             when 'entrada' then actual + p_cantidad
             when 'salida'  then actual - p_cantidad
             else p_cantidad          -- ajuste: la cantidad ES el nuevo stock
           end;
  if nuevo < 0 then
    raise exception 'No hay suficiente: quedan % y quieres sacar %.', actual, p_cantidad;
  end if;

  update public.insumos set stock = nuevo, updated_at = now() where id = iid;
  insert into public.insumo_movimientos (insumo_id, tipo, cantidad, stock_resultante, motivo, created_by)
    values (iid, p_tipo, p_cantidad, nuevo, nullif(btrim(coalesce(p_motivo,'')), ''), auth.uid());

  return nuevo;
end;
$$;
grant execute on function public.mover_insumo(uuid, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. `updated_at` de las tablas que se editan.
-- ---------------------------------------------------------------------------
create or replace function public.bodega_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
  trg text;
begin
  foreach t in array array[
    'recepcion_items','conjuntos','personalizados','envios_full','insumos'
  ] loop
    trg := t || '_touch_trg';
    execute format('drop trigger if exists %I on public.%I', trg, t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.bodega_touch()', trg, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Permisos + RLS. Matriz de inventario (ver/gestionar interno, borrar
--    gestor), salvo los insumos, que llevan la jerarquía aparte.
-- ---------------------------------------------------------------------------
grant all on
  public.recepciones_bodega, public.recepcion_items,
  public.conjuntos, public.conjunto_componentes,
  public.personalizados,
  public.envios_full, public.envio_full_cajas, public.envio_full_items,
  public.insumos, public.insumo_movimientos, public.insumo_permisos
  to authenticated, service_role;

alter table public.recepciones_bodega   enable row level security;
alter table public.recepcion_items      enable row level security;
alter table public.conjuntos            enable row level security;
alter table public.conjunto_componentes enable row level security;
alter table public.personalizados       enable row level security;
alter table public.envios_full          enable row level security;
alter table public.envio_full_cajas     enable row level security;
alter table public.envio_full_items     enable row level security;
alter table public.insumos              enable row level security;
alter table public.insumo_movimientos   enable row level security;
alter table public.insumo_permisos      enable row level security;

-- Las ocho tablas "normales" de bodega comparten la misma matriz: se generan
-- para no repetir treinta políticas idénticas a mano.
do $$
declare t text;
begin
  foreach t in array array[
    'recepciones_bodega','recepcion_items','conjuntos','conjunto_componentes',
    'personalizados','envios_full','envio_full_cajas','envio_full_items'
  ] loop
    execute format('drop policy if exists "%s: ver (interno)" on public.%I', t, t);
    execute format(
      'create policy "%s: ver (interno)" on public.%I
         for select to authenticated using (public.es_interno())', t, t);

    execute format('drop policy if exists "%s: gestionar (interno)" on public.%I', t, t);
    execute format(
      'create policy "%s: gestionar (interno)" on public.%I
         for all to authenticated using (public.es_interno()) with check (public.es_interno())',
      t, t);
  end loop;
end $$;

-- Insumos: verlos es de todo el equipo interno (Germán tiene que poder mirar);
-- darlos de alta y editarlos es administrativo.
drop policy if exists "insumos: ver (interno)" on public.insumos;
create policy "insumos: ver (interno)" on public.insumos
  for select to authenticated using (public.es_interno());
drop policy if exists "insumos: gestionar (admin)" on public.insumos;
create policy "insumos: gestionar (admin)" on public.insumos
  for all to authenticated using (public.es_administrativo()) with check (public.es_administrativo());

-- Los movimientos se leen todos y se escriben SOLO por mover_insumo() (security
-- definer): sin policy de insert, nadie puede meter un movimiento suelto que
-- no haya ajustado el stock.
drop policy if exists "insumo movimientos: ver (interno)" on public.insumo_movimientos;
create policy "insumo movimientos: ver (interno)" on public.insumo_movimientos
  for select to authenticated using (public.es_interno());

-- El permiso lo ve todo el equipo (para saber a quién pedirle que descuente) y
-- lo otorga solo la administración.
drop policy if exists "insumo permisos: ver (interno)" on public.insumo_permisos;
create policy "insumo permisos: ver (interno)" on public.insumo_permisos
  for select to authenticated using (public.es_interno());
drop policy if exists "insumo permisos: gestionar (admin)" on public.insumo_permisos;
create policy "insumo permisos: gestionar (admin)" on public.insumo_permisos
  for all to authenticated using (public.es_administrativo()) with check (public.es_administrativo());

-- ---------------------------------------------------------------------------
-- 8. Storage: bucket privado para la foto del diseño aprobado de un
--    personalizado. Ruta: personalizados/<personalizado_id>/<archivo>.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('personalizados', 'personalizados', false)
  on conflict (id) do nothing;

drop policy if exists "personalizados storage: ver" on storage.objects;
create policy "personalizados storage: ver" on storage.objects
  for select to authenticated
  using (bucket_id = 'personalizados' and public.es_interno());

drop policy if exists "personalizados storage: subir" on storage.objects;
create policy "personalizados storage: subir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'personalizados' and public.es_interno());

drop policy if exists "personalizados storage: borrar" on storage.objects;
create policy "personalizados storage: borrar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'personalizados' and public.es_interno());

notify pgrst, 'reload schema';
