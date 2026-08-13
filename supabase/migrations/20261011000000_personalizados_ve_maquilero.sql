-- ============================================================================
-- 20261011000000_personalizados_ve_maquilero.sql
--   Que Eduardo vea el diseño DENTRO de la tabla, no la foto de la tienda.
-- ----------------------------------------------------------------------------
-- QUÉ RESUELVE. En el tablero de maquila la miniatura de cada renglón es
-- `maquila_pedidos.imagen_url`: la portada del producto en Tienda Nube. Para un
-- personalizado esa foto es la del cinturón genérico —la misma en los ocho
-- pedidos—, así que no dice nada. Lo que sirve para producir es el arte que
-- subió el diseñador, y ese vive en `personalizados.foto_path`.
--
-- EL CANDADO QUE FALTABA. El binario ya lo alcanza: 20261002000000 le abrió el
-- bucket con `maquilero_ve_personalizado()`. Pero la RUTA está en la tabla
-- `personalizados`, cuyas únicas policies son `es_interno()` — y `es_interno()`
-- NO incluye al maquilero (20260819000000: direccion, administracion,
-- coordinador, miembro). Es decir: Eduardo tiene permiso para ver la imagen
-- pero no para saber dónde está.
--
-- Eso también explica un fallo que nadie había reportado: `urlDisenoDePedido`
-- (app/(app)/maquila/acciones/disenos.ts) lee `personalizados.foto_path` con la
-- sesión de quien pulsa, así que a Eduardo le devolvía «Este pedido todavía no
-- tiene diseño cargado» sobre pedidos que SÍ lo tenían. Con esta policy el
-- botón de descargar el arte empieza a funcionar para él.
--
-- POR QUÉ REUSA `maquilero_ve_personalizado(id)`. Es exactamente el mismo
-- criterio que ya gobierna el bucket: solo las fichas que cuelgan de un pedido
-- suyo, y solo cuando el pedido salió de «esperando pago». Repetir el EXISTS
-- aquí dejaría dos definiciones que se separarían al primer cambio. La función
-- ya trae dentro su propio `es_maquilero()`.
--
-- ALCANCE. Es SELECT y nada más: escribir en la ficha sigue siendo del equipo.
-- Le llega la fila entera (cliente, notas, fechas), que es lo mismo que ya ve
-- en el pedido —`envio_nombre`, la promesa— más las notas de diseño, que son
-- justo lo que necesita para producir. Ningún dato de dinero vive ahí.
--
-- Idempotente (`drop policy if exists`): se puede volver a correr sin daño.
-- APLICADA en prod el 12/08/2026 con `supabase db push`.
-- ============================================================================

set lock_timeout = '10s';

drop policy if exists "personalizados: ver (maquilero)" on public.personalizados;
create policy "personalizados: ver (maquilero)" on public.personalizados
  for select to authenticated
  using ((select public.maquilero_ve_personalizado(id)));

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   -- Deben salir TRES: ver (interno), gestionar (interno), ver (maquilero).
--   select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'personalizados';
--
--   -- Cuántas fichas alcanzaría Eduardo (las ligadas a un pedido ya pagado):
--   select count(distinct p.personalizado_id)
--     from public.maquila_pedidos p
--    where p.personalizado_id is not null and p.estado <> 'esperando_pago';
--
--   -- Y de esas, cuántas tienen arte que pintar en el tablero:
--   select count(*) from public.personalizados f
--    where f.foto_path is not null
--      and exists (select 1 from public.maquila_pedidos p
--                   where p.personalizado_id = f.id and p.estado <> 'esperando_pago');
-- ============================================================================
