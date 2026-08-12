-- ============================================================================
-- 20261008000000_maquila_imagen.sql
--   La foto del cinto, dentro del pedido.
-- ----------------------------------------------------------------------------
-- POR QUÉ UNA COLUMNA Y NO UN JOIN A `products`. Es la regla que gobierna toda
-- la tabla: `maquila_pedidos` lleva TODO en snapshot porque el tablero de
-- Eduardo no puede joinear nada. Y no es una preferencia de rendimiento —
-- `es_interno()` es (direccion, coordinador, miembro) y NO incluye `maquilero`
-- (20250103000000, línea 20), así que la RLS de `products` le devuelve vacío:
-- un join le pintaría la foto en blanco justo a quien tiene que ver el diseño
-- para fabricarlo.
--
-- Es también la razón de que la foto se congele: si mañana se cambia la imagen
-- de catálogo de un SKU, los pedidos viejos conservan la que se produjo. El
-- pedido es evidencia de lo que se fabricó, no una vista del catálogo de hoy.
--
-- OJO CON LOS PERSONALIZADOS. Para ellos esta imagen es la GENÉRICA del
-- producto de Tienda Nube ("Cinturon de Hebilla Personalizado"), no el arte del
-- cliente: ése vive en `personalizados.foto_path` o en `maquila_disenos`, y se
-- llega a él ligando el pedido desde su detalle (ligarPersonalizadoAPedido).
--
-- NO HACE FALTA TOCAR validar_cambio_maquila: su lista blanca congela «las
-- columnas que se agreguen en el futuro» para el maquilero (20260924000000,
-- línea 172), así que Eduardo no puede cambiar la foto y no hay que hacer nada
-- para conseguirlo.
--
-- Idempotente: se puede pegar tal cual las veces que haga falta.
-- ============================================================================

set lock_timeout = '10s';

alter table public.maquila_pedidos
  add column if not exists imagen_url text;

comment on column public.maquila_pedidos.imagen_url is
  'Portada del producto al momento del pedido (snapshot de products.imagen_url). En los personalizados es la foto genérica del producto, no el arte del cliente.';

-- Los pedidos que ya existen: se les copia la portada que tenga su ficha hoy.
-- No dispara nada — los triggers de guías y de consignación miran `estado` y
-- `enviado_en`, y validar_cambio_maquila solo muerde si quien escribe es el
-- maquilero (aquí es el SQL Editor, donde auth.uid() es null).
update public.maquila_pedidos m
   set imagen_url = p.imagen_url
  from public.products p
 where p.id = m.producto_id
   and m.imagen_url is null
   and p.imagen_url is not null;

-- `sales` y `products` tienen grants por columna, pero `maquila_pedidos` no
-- (ver 20261004000000_grants_columna_al_dia.sql): aquí el `grant all` de tabla
-- de 20260924000000 ya cubre la columna nueva.

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   -- Cuántos pedidos quedaron con foto (deberían ser los 135 del respaldo):
--   select count(*) filter (where imagen_url is not null) as con_foto,
--          count(*) as total
--     from public.maquila_pedidos;
--
--   -- Y que sea la del catálogo, no otra cosa:
--   select sku, left(imagen_url, 60) from public.maquila_pedidos
--    where imagen_url is not null limit 5;
--
-- DESPUÉS de aplicar esto hay que regenerar los tipos, o el typecheck no
-- conocerá la columna nueva:
--
--       pnpm gen:types
-- ============================================================================
