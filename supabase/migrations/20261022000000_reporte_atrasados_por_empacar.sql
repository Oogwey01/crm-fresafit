-- ============================================================================
-- 20261022000000_reporte_atrasados_por_empacar.sql — El Reporte cuenta como
-- atrasado lo que de verdad falta por empacar
-- ----------------------------------------------------------------------------
-- QUÉ ESTÁ MAL. El Reporte Fresafit dice "N pedidos atrasados" contando TODO lo
-- que no está entregado ni cancelado y tiene más de tres días. Ahí dentro caben
-- los que ya salieron —van en la calle, nadie los va a despachar otra vez—, los
-- devueltos, los que esperan la colecta con la etiqueta puesta y los de Mercado
-- Full, que despacha Mercado Libre desde su centro. La pantalla de Pedidos dejó
-- de contarlos así, y hoy las dos dan cifras distintas del mismo dato.
--
-- CÓMO PASÓ, que es lo que conviene no repetir. 20260926000200 ya había
-- parchado esto (`estado in ('nuevo','preparando')`), pero 20261013000000
-- recreó `reporte_fresafit` ENTERA para otra cosa —el cuadre de órdenes
-- retiradas— copiando el cuerpo de la versión anterior al parche. Un
-- `create or replace` de 500 líneas se lleva por delante cualquier arreglo
-- puntual que no esté en el archivo de origen, sin avisar.
--
-- LA REGLA, EN UN SOLO SITIO. En vez de volver a escribir el criterio dentro de
-- la función, nace `pedido_por_empacar()`: la misma pregunta que responde
-- `situacionPreparacion()` en lib/canales/despacho.ts, escrita una vez en SQL.
-- Son espejos declarados, como `es_interno()` / `esInterno()`. Si mañana ML
-- inventa otro subestado, se cambian los dos — pero al menos son dos sitios
-- nombrados y no cinco copias del mismo `not in`.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

-- --------------------------------------------------------- 1. la regla
-- ¿Este renglón es trabajo de bodega ahora mismo? Espejo de
-- situacionPreparacion() + hayTrabajo() (lib/canales/despacho.ts).
--
-- Los NULL cuentan como trabajo A PROPÓSITO: Tienda Nube no manda ni logística
-- ni subestado, y un pedido del que no se sabe nada hay que ir a mirarlo. Es el
-- lado seguro y es lo que hace el código de la pantalla.
create or replace function public.pedido_por_empacar(
  p_estado    text,
  p_logistica text,
  p_subestado text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_estado in ('nuevo', 'preparando')
     -- Mercado Full (y su variante fulfillment_extended): el paquete vive en un
     -- centro de ML, que lo empaca y lo despacha. Nunca fue trabajo de aquí.
     and coalesce(p_logistica, '') not like 'fulfillment%'
     -- Ya empacado y etiquetado: solo falta que pase el transportista.
     and coalesce(p_subestado, '') not in
         ('ready_for_pickup', 'ready_to_ship', 'printed', 'picked');
$$;

comment on function public.pedido_por_empacar(text, text, text) is
  'Espejo SQL de situacionPreparacion()+hayTrabajo() (lib/canales/despacho.ts): el renglon todavia da trabajo de bodega. Los NULL cuentan como trabajo (Tienda Nube no reporta subestado).';

grant execute on function public.pedido_por_empacar(text, text, text)
  to authenticated, service_role;

-- ------------------------------------ 2. el reporte, con la regla nueva
-- Se parcha sobre la definición VIVA en vez de repetir aquí las ~500 líneas de
-- la función, que pertenecen a otra migración y divergirían al primer cambio
-- (mismo criterio y mismo mecanismo que usó 20260926000200).
--
-- Son dos reemplazos, no uno: la CTE `pedidos` solo selecciona `estado` y
-- `fecha`, así que primero hay que hacerle sitio a las dos columnas del envío.
do $$
declare
  def   text;
  nuevo text;
  -- (1) la CTE, para que traiga con qué decidir.
  cte_vieja constant text := 'select s.estado, s.fecha from public.sales s';
  cte_nueva constant text :=
    'select s.estado, s.fecha, s.envio_logistica, s.envio_subestado from public.sales s';
  -- (2) el conteo.
  conteo_viejo constant text :=
    'where estado not in (''entregado'',''cancelado'') and fecha < limite_atraso';
  conteo_nuevo constant text :=
    'where public.pedido_por_empacar(estado, envio_logistica, envio_subestado) and fecha < limite_atraso';
  tocadas integer := 0;
begin
  for def in
    select pg_get_functiondef(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'reporte_fresafit'
  loop
    nuevo := replace(replace(def, cte_vieja, cte_nueva), conteo_viejo, conteo_nuevo);
    if nuevo is distinct from def then
      execute nuevo;
      tocadas := tocadas + 1;
    end if;
  end loop;

  if tocadas = 0 then
    raise notice
      'reporte_fresafit: no se encontro que parchar (ya estaba, o el cuerpo cambio de forma). Revisar a mano.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, DESPUÉS de este archivo)
-- ----------------------------------------------------------------------------
-- 1) La regla responde lo que debe:
--
--      select public.pedido_por_empacar('preparando', 'cross_docking', null)      as por_empacar_si,
--             public.pedido_por_empacar('preparando', 'fulfillment', 'in_warehouse') as full_no,
--             public.pedido_por_empacar('preparando', 'cross_docking', 'ready_for_pickup') as listo_no,
--             public.pedido_por_empacar('enviado', null, null)                    as enviado_no,
--             public.pedido_por_empacar('nuevo', null, null)                      as tienda_nube_si;
--
--    Esperado: true, false, false, false, true.
--
-- 2) El parche entró (las dos piezas tienen que aparecer):
--
--      select pg_get_functiondef(oid) like '%pedido_por_empacar(estado%' as usa_la_regla,
--             pg_get_functiondef(oid) like '%s.envio_logistica, s.envio_subestado%' as cte_ampliada
--        from pg_proc where proname = 'reporte_fresafit';
--
-- 3) El Reporte y la pantalla de Pedidos dicen ya el mismo número: abrir
--    /reportes y comparar "Pedidos atrasados" con el KPI "Urgentes" de /pedidos.
-- ============================================================================
