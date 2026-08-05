-- ============================================================================
-- 20260822000000_insumos_recursos.sql — La hoja «Recursos FRESA FIT»
-- ----------------------------------------------------------------------------
-- La hoja no lleva solo cuánto hay: lleva de quién se compra, en qué medida, a
-- qué precio y en qué presentación (la misma etiqueta se compra en paquetes de
-- 300, 1000, 1800 o 3600). Por eso el precio NO va en la ficha del insumo sino
-- en `insumo_presentaciones`. Las categorías con su color (bolsas, etiquetas,
-- sobres, cintas, cajas) viven en lib/catalogos.ts, como el resto del CRM.
--
-- Va en su propio archivo, separado de personalizados y gastos: el editor SQL
-- corre todo el buffer en UNA transacción, y un script que tomaba el candado
-- exclusivo de tres tablas a la vez terminó en deadlock contra la app en
-- producción, que las estaba leyendo. Un archivo = una tabla = candado corto.
--
-- Idempotente: se puede volver a pegar sin duplicar nada.
-- ============================================================================

-- Si la app tiene una lectura larga encima de `insumos`, mejor fallar en 10 s
-- con un mensaje claro que quedarse colgado bloqueando al resto.
set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Lo que la hoja sabe y la tabla todavía no.
-- ---------------------------------------------------------------------------
alter table public.insumos
  add column if not exists categoria   text,          -- id de CATEGORIAS_INSUMO (lib/catalogos.ts)
  add column if not exists empresa     text,          -- a quién se le compra (Castipack, Etifast, Uline…)
  add column if not exists dimensiones text,
  add column if not exists reserva     numeric(12,2) not null default 0,  -- apartado, ya no disponible
  add column if not exists pedido      numeric(12,2) not null default 0,  -- en camino
  add column if not exists maximo      numeric(12,2),                     -- tope: arriba de esto sobra dinero parado
  add column if not exists link        text,
  -- Llave natural de la hoja: permite recargarla sin duplicar.
  add column if not exists clave       text;

create unique index if not exists insumos_clave_idx on public.insumos (clave);
create index if not exists insumos_categoria_idx on public.insumos (categoria);

-- ---------------------------------------------------------------------------
-- 2. Presentación de compra: el mismo insumo se compra en varias medidas y cada
--    una tiene su precio, su apartado y su pedido en curso. El precio por unidad
--    NO se guarda: es precio/unidades, y guardarlo era invitar a que las dos
--    cifras dejaran de coincidir (en la hoja ya pasa con el sello de Uline).
-- ---------------------------------------------------------------------------
create table if not exists public.insumo_presentaciones (
  id          uuid primary key default gen_random_uuid(),
  insumo_id   uuid not null references public.insumos(id) on delete cascade,
  descripcion text,
  unidades    int not null default 1 check (unidades > 0),
  precio      numeric(12,2) check (precio >= 0),
  reserva     numeric(12,2) not null default 0,
  pedido      numeric(12,2) not null default 0,
  link        text,
  clave       text,
  created_at  timestamptz not null default now()
);
create unique index if not exists insumo_present_clave_idx on public.insumo_presentaciones (clave);
create index if not exists insumo_present_insumo_idx on public.insumo_presentaciones (insumo_id);

grant all on public.insumo_presentaciones to authenticated, service_role;
alter table public.insumo_presentaciones enable row level security;

-- Mismo criterio que `insumos`: todo el equipo interno consulta precios y
-- proveedores; solo la administración los cambia.
drop policy if exists "insumo presentaciones: ver (interno)" on public.insumo_presentaciones;
create policy "insumo presentaciones: ver (interno)" on public.insumo_presentaciones
  for select to authenticated using (public.es_interno());
drop policy if exists "insumo presentaciones: gestionar (admin)" on public.insumo_presentaciones;
create policy "insumo presentaciones: gestionar (admin)" on public.insumo_presentaciones
  for all to authenticated using (public.es_administrativo()) with check (public.es_administrativo());

-- ---------------------------------------------------------------------------
-- 3. Carga de la hoja.
--    `stock` es la columna DISPONIBLE / TOTAL UNIDADES. Se carga también su
--    movimiento de entrada para que el histórico no arranque mudo.
-- ---------------------------------------------------------------------------
insert into public.insumos
  (clave, nombre, categoria, empresa, dimensiones, unidad, stock, minimo, maximo, reserva, pedido, notas)
values
  ('recursos-bolsa-accesorios',   'Bolsa para accesorios',   'bolsas',    'Castipack',    '20 x 28 cm',      'bolsa',   1200, 1000, 2000, 2, 4, null),
  ('recursos-bolsa-cinturones',   'Bolsa para cinturones',   'bolsas',    'Para Paquetes','30 x 40 cm',      'bolsa',    200,  300, null, 1, 1, null),
  ('recursos-bolsa-mochilas',     'Bolsa para mochilas',     'bolsas',    'Neipack',      '55 x 60 cm',      'bolsa',    300,  300, null, 0, 3, null),
  ('recursos-etiqueta-paquetes',  'Etiqueta de paquetería',  'etiquetas', 'Etifast',      '105 x 152 mm',    'etiqueta',1500, 1500, null, 3, 2, null),
  ('recursos-etiqueta-barras',    'Etiqueta código de barras','etiquetas','Etifast',      '58 x 40 mm',      'etiqueta',2000, 2000, null, 0, 2, null),
  ('recursos-sobre',              'Sobre',                   'sobres',    'Para Paquetes','25 x 17 cm',      'sobre',    200,  200, null, 2, 0, null),
  ('recursos-cinta-filamentos',   'Cinta café con filamentos','cintas',   'Crearton',     '70 mm x 137 m',   'rollo',      2,    2, null, 2, 0, null),
  ('recursos-cinta-sello',        'Cinta sello de seguridad','cintas',    'Uline',         null,             'rollo',      1,    2,    4, 2, 2,
     'La hoja marca $1,292.17 por unidad contra $1,252.76 de precio: hay que confirmar cuál es.'),
  ('recursos-cinta-transparente', 'Cinta transparente',      'cintas',    null,           '480 mm x 150 m',  'rollo',     12,   12, null, 1, 1, null),
  ('recursos-caja-paquetes',      'Caja de paquetería',      'cajas',     null,           '23 x 23 x 15 cm', 'caja',       0,    0, null, 0, 0,
     'Sin precio ni existencia en la hoja: falta capturarlos.'),
  ('recursos-caja-larga',         'Caja larga',              'cajas',     null,           '140 x 38 x 27 cm','caja',       0,    0, null, 0, 0,
     'Sin precio ni existencia en la hoja: falta capturarlos.')
on conflict (clave) do nothing;

-- Presentaciones (precio por paquete). `reserva` y `pedido` van a la presentación
-- concreta: en la hoja son «tengo 2 paquetes apartados y 4 pedidos», no piezas.
insert into public.insumo_presentaciones (clave, insumo_id, descripcion, unidades, precio, reserva, pedido)
select v.clave, i.id, v.descripcion, v.unidades, v.precio, v.reserva, v.pedido
  from (values
    ('recursos-bolsa-accesorios-100',   'recursos-bolsa-accesorios',   'Paquete de 100',   100,  164.68, 0, 0),
    ('recursos-bolsa-accesorios-200',   'recursos-bolsa-accesorios',   'Paquete de 200',   200,  298.00, 2, 4),
    ('recursos-bolsa-cinturones-100',   'recursos-bolsa-cinturones',   'Paquete de 100',   100,  216.00, 1, 1),
    ('recursos-bolsa-mochilas-100',     'recursos-bolsa-mochilas',     'Paquete de 100',   100,  670.36, 0, 3),
    ('recursos-etiqueta-paquetes-300',  'recursos-etiqueta-paquetes',  'Paquete de 300',   300,  139.00, 3, 2),
    ('recursos-etiqueta-paquetes-1000', 'recursos-etiqueta-paquetes',  'Paquete de 1000', 1000,  539.00, 0, 0),
    ('recursos-etiqueta-paquetes-1800', 'recursos-etiqueta-paquetes',  'Paquete de 1800', 1800,  899.00, 0, 0),
    ('recursos-etiqueta-paquetes-3600', 'recursos-etiqueta-paquetes',  'Paquete de 3600', 3600, 1768.00, 0, 0),
    ('recursos-etiqueta-barras-1000',   'recursos-etiqueta-barras',    'Paquete de 1000', 1000,  103.55, 0, 2),
    ('recursos-sobre-100',              'recursos-sobre',              'Paquete de 100',   100,  178.62, 2, 0),
    ('recursos-cinta-filamentos-1',     'recursos-cinta-filamentos',   'Rollo',              1,  221.00, 2, 0),
    ('recursos-cinta-sello-1',          'recursos-cinta-sello',        'Rollo',              1, 1252.76, 2, 2),
    ('recursos-cinta-transparente-6',   'recursos-cinta-transparente', 'Paquete de 6',       6,  158.40, 1, 1)
  ) as v(clave, insumo_clave, descripcion, unidades, precio, reserva, pedido)
  join public.insumos i on i.clave = v.insumo_clave
on conflict (clave) do nothing;

-- El histórico arranca con la existencia que traía la hoja.
insert into public.insumo_movimientos (insumo_id, tipo, cantidad, stock_resultante, motivo)
select i.id, 'entrada', i.stock, i.stock, 'Carga inicial desde la hoja «Recursos FRESA FIT»'
  from public.insumos i
 where i.clave like 'recursos-%'
   and i.stock > 0
   and not exists (
     select 1 from public.insumo_movimientos m
      where m.insumo_id = i.id
        and m.motivo = 'Carga inicial desde la hoja «Recursos FRESA FIT»'
   );

notify pgrst, 'reload schema';
