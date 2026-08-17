-- ============================================================================
-- 20261023000000_personalizados_promesa_y_correo.sql
-- La promesa al cliente son 33 días naturales, y se le puede avisar por correo
-- ----------------------------------------------------------------------------
-- DOS COSAS, UNA SOLA TABLA (por eso van juntas; ver 20260822000100 sobre por
-- qué un archivo toca una tabla y nada más).
--
-- 1. LA PROMESA. Un personalizado se le promete al cliente a 33 días NATURALES
--    desde que entra el cinto. Eso es lo que el equipo capturaba a mano en la
--    hoja «Personalizados FRESA FIT» —las ~150 fichas históricas traen entre 30
--    y 33 días— y lo que se sigue diciendo al vender.
--
--    Cuando la ficha empezó a nacer sola desde maquila (lib/personalizados/
--    desde-maquila.ts) se copió `maquila_pedidos.fecha_prometida` en el hueco,
--    y esa fecha mide OTRA cosa: el plazo del TALLER, 7 o 10 días HÁBILES desde
--    el pago (lib/maquila/reglas.ts), o sea 11-13 naturales. Resultado: las
--    fichas nuevas nacían con la mitad del plazo y /personalizados las pintaba
--    «fuera de fecha» cuando les sobraban tres semanas.
--
--    El código ya calcula bien (lib/personalizados/plazo.ts). Esto repara lo
--    que quedó escrito. El UPDATE es DELIBERADAMENTE ESTRECHO:
--      · solo fichas de alta automática (la nota que escribe la siembra),
--      · solo abiertas —lo enviado es archivo y no se reescribe—,
--      · y solo si la fecha que tienen es MENOR que compra+33: nunca acorta un
--        plazo, así que una fecha renegociada a mano con el cliente (más larga)
--        se queda como está.
--    Medido en producción el 17/08/2026: 56 fichas entran, 1 se queda fuera (la
--    #7753, con el año de compra mal capturado desde la hoja).
--
-- 2. EL AVISO AL CLIENTE. Se le manda un correo de confirmación con lo que
--    pidió, cómo funciona el proceso y para cuándo lo tendrá. Las dos columnas
--    nuevas son el sello de que salió: sirven para no mandarlo dos veces por
--    accidente y para que la ficha enseñe a qué dirección se escribió.
--
--    NO es una bitácora de correos —no existe tal tabla en el CRM— sino el
--    mismo patrón de `empresa_documentos.aviso_vencimiento_en` (20260916000000):
--    un sello por fila, que es lo que hace falta para decidir si toca escribir.
--
-- Sin GRANT nuevos: `personalizados` no tiene grants por columna (eso es solo
-- `sales` y `products`, ver 20260902000000), así que las columnas nacen
-- legibles para el equipo interno. Sin RLS nueva: quien ya podía actualizar la
-- ficha es quien sella el envío.
--
-- Idempotente: se puede volver a correr y la segunda pasada no mueve nada.
-- ============================================================================

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. El sello del correo al cliente
-- ---------------------------------------------------------------------------
alter table public.personalizados
  add column if not exists correo_enviado_en timestamptz,
  add column if not exists correo_enviado_a  text;

comment on column public.personalizados.correo_enviado_en is
  'Cuándo salió la confirmación al cliente. NULL = todavía no se le ha escrito.';
comment on column public.personalizados.correo_enviado_a is
  'A qué dirección se mandó, congelada al momento del envío: el correo del cliente puede cambiar después en customers.';

-- ---------------------------------------------------------------------------
-- 2. Reparar la fecha límite de las fichas que nacieron con el plazo del taller
-- ---------------------------------------------------------------------------
update public.personalizados
   set fecha_limite = fecha_compra + interval '33 days'
 where notas = 'Alta automática desde la venta: falta el arte.'
   and estado in ('recibido','diseno','eduardo','produccion')
   and fecha_compra is not null
   and (fecha_limite is null or fecha_limite < fecha_compra + interval '33 days');

notify pgrst, 'reload schema';
