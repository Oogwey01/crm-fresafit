-- ============================================================================
-- 20260822000200_gastos_facturas.sql — La hoja «Facturas FRESA FIT»
-- ----------------------------------------------------------------------------
-- Los gastos ya existían; lo que faltaba es lo que la hoja usa para saber qué
-- sigue pendiente: con qué se pagó, si ya hay factura y si ya hay recibo.
-- 'pendiente' es el «Aun no» de la hoja: se pagó, pero el papel no ha llegado.
--
-- Archivo aparte de insumos y personalizados a propósito: el editor SQL corre
-- todo el buffer en una sola transacción, y tocar tres tablas de golpe
-- deadlockeó contra la app en producción. Un archivo = una tabla = candado corto.
--
-- Idempotente: se puede volver a pegar sin duplicar gastos.
-- ============================================================================

set lock_timeout = '10s';

alter table public.expenses
  add column if not exists metodo_pago text,
  add column if not exists factura     text not null default 'pendiente',
  add column if not exists recibo      text not null default 'pendiente',
  -- Llave natural de la hoja: permite recargarla sin duplicar.
  add column if not exists clave       text;

alter table public.expenses drop constraint if exists expenses_factura_check;
alter table public.expenses add constraint expenses_factura_check
  check (factura in ('si','no','pendiente'));
alter table public.expenses drop constraint if exists expenses_recibo_check;
alter table public.expenses add constraint expenses_recibo_check
  check (recibo in ('si','no','pendiente'));

create unique index if not exists expenses_clave_idx on public.expenses (clave);

-- ---------------------------------------------------------------------------
-- Carga de la hoja (julio 2026).
-- ---------------------------------------------------------------------------
insert into public.expenses (clave, fecha, concepto, monto, categoria, proveedor, metodo_pago, factura, recibo)
values
  ('ff-2026-07-etiquetas-termicas',   '2026-07-06', 'Etiquetas térmicas',           454.93, 'logistica', 'Etifast',      'TC Mercado Pago', 'si',        'pendiente'),
  ('ff-2026-07-shopify',              '2026-07-06', 'Shopify',                     1140.62, 'operacion', 'Shopify',      'TC Mercado Pago', 'pendiente', 'si'),
  ('ff-2026-07-workspace-julio',      '2026-07-06', 'Google Workspace julio 2026',  678.94, 'operacion', 'Google',       'TC Mercado Pago', 'pendiente', 'si'),
  ('ff-2026-07-workspace-junio',      '2026-07-02', 'Google Workspace junio 2026', 4430.27, 'operacion', 'Google',        null,             'no',        'si'),
  ('ff-2026-07-nuvemchat',            '2026-07-06', 'Nuvemchat de Tiendanube',      379.80, 'operacion', 'Tienda Nube',  'TC Mercado Pago', 'pendiente', 'pendiente'),
  ('ff-2026-07-abono-1',              '2026-07-04', 'Abono facturado',             7000.00, 'otro',       null,          'Transferencia',   'si',        'si'),
  ('ff-2026-07-abono-2',              '2026-07-04', 'Abono facturado 2',           2000.00, 'otro',       null,          'Transferencia',   'si',        'si'),
  ('ff-2026-07-abono-3',              '2026-07-08', 'Abono facturado 3',           6806.26, 'otro',       null,          'Transferencia',   'si',        'si'),
  ('ff-2026-07-astroselling',         '2026-07-08', 'Astroselling',                 949.13, 'operacion', 'Astroselling', 'TC Mercado Pago', 'no',        'si'),
  ('ff-2026-07-adobe',                '2026-07-08', 'Adobe',                       1449.00, 'operacion', 'Adobe',        'TC Mercado Pago', 'pendiente', 'pendiente'),
  ('ff-2026-07-nomina-1ra',           '2026-07-15', 'Nóminas 1ra julio 2026',     35750.00, 'nomina',     null,          'Transferencia',   'si',        'si'),
  ('ff-2026-07-imss-junio',           '2026-07-20', 'IMSS junio 2026',            19129.11, 'nomina',    'IMSS',         'Transferencia',   'pendiente', 'si'),
  ('ff-2026-07-honorarios-jano',      '2026-07-15', 'Honorarios Jano',             3480.00, 'nomina',    'Jano',         'Transferencia',   'si',        'pendiente'),
  ('ff-2026-07-renta-andenes',        '2026-07-23', 'Renta andenes',              36725.00, 'operacion',  null,          'Transferencia',   'si',        'si'),
  ('ff-2026-07-luz-steren-1',         '2026-07-22', 'Equipo de luz Steren',         399.00, 'operacion', 'Steren',        null,             'pendiente', 'pendiente'),
  ('ff-2026-07-luz-steren-2',         '2026-07-23', 'Equipo de luz Steren 2',      1630.02, 'operacion', 'Steren',        null,             'pendiente', 'pendiente'),
  ('ff-2026-07-honorarios-contadores','2026-07-31', 'Honorarios contadores',       9280.00, 'operacion',  null,          'Transferencia',   'pendiente', 'si')
on conflict (clave) do nothing;

notify pgrst, 'reload schema';
