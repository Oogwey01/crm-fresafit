-- ============================================================================
-- 20261024000000_empaque_tablero.sql — En qué punto de la MESA va cada paquete
-- ----------------------------------------------------------------------------
-- QUÉ FALTABA. Bodega no usaba /pedidos para empacar: usaba un "Rastreador de
-- paquetes" hecho aparte, un HTML suelto fuera del CRM, porque la tabla de «Por
-- empacar» no dice lo único que importa mientras se arma una caja — en qué punto
-- va cada paquete—. Ese rastreador mueve los pedidos por cuatro etapas físicas:
--
--     Preparado → Revisión de calidad → Sellado y esperando recolección → Recolectado
--
-- El CRM no tenía ese vocabulario, y no por descuido: `sales.estado` describe el
-- viaje del pedido DE CARA AL CANAL (nuevo → preparando → enviado → entregado),
-- no el trabajo de la mesa. Los dos son ciertos a la vez y ninguno sustituye al
-- otro: un pedido puede llevar veinte minutos en "Revisión de calidad" y para
-- Mercado Libre seguir siendo, correctamente, "preparando".
--
-- Tampoco servía el subestado del canal (20261021000000): ese lo escribe la sync
-- leyendo a Mercado Libre, es de SOLO LECTURA para nosotros, y no distingue las
-- etapas de aquí dentro. El "Listo para recolección" del canal llega cuando la
-- guía se imprime; el "Sellado" de la mesa es media hora antes y lo sabe quien
-- está empacando, nadie más.
--
-- LO QUE SE GUARDA:
--   · etapa_empaque     — la columna del tablero (catálogo en lib/catalogos.ts)
--   · etapa_empaque_en  — cuándo entró a esa columna; alimenta el "1h 11min en
--                         esta etapa", que es lo que delata el paquete atorado
--   · empaque           — caja, bolsa mediana… El conteo de arriba del tablero
--                         es lo que se le dice al de la paquetería por teléfono
--
-- Y LO QUE NO: nada de esto viaja a ningún canal. `CANALES_SOLO_LECTURA` sigue
-- puesto (ver ARQUITECTURA.md); son datos nuestros, de esta bodega, y la sync
-- (`sincronizar_renglones_venta`) ni los conoce ni debe conocerlos.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

-- ------------------------------------------------------------ 1. las columnas
alter table public.sales add column if not exists etapa_empaque    text;
alter table public.sales add column if not exists etapa_empaque_en timestamptz;
alter table public.sales add column if not exists empaque          text;

comment on column public.sales.etapa_empaque is
  'Etapa FISICA de la mesa de empaque (preparado, calidad, sellado, recolectado). Dato interno de bodega: no viene de ningun canal ni viaja a ninguno. NULL = nadie lo ha tocado todavia, el tablero lo pinta en la primera columna.';
comment on column public.sales.etapa_empaque_en is
  'Cuando entro a la etapa actual. Alimenta el "1h 11min en esta etapa" del tablero: sin el, un paquete atorado se ve igual que uno recien puesto.';
comment on column public.sales.empaque is
  'En que se empaco (caja, bolsa_mediana...). Catalogo en lib/catalogos.ts; aqui se guarda el id.';

-- La regla de 20261004000000: `authenticated` tiene el SELECT de `sales` por
-- COLUMNA, así que una columna nueva nace ilegible para el navegador y la
-- pantalla revienta con "permission denied for table sales" sin decir cuál es.
grant select (etapa_empaque)    on public.sales to authenticated;
grant select (etapa_empaque_en) on public.sales to authenticated;
grant select (empaque)          on public.sales to authenticated;

-- --------------------------------------------------------- 2. qué es válido
-- Declaradas aparte, con el mismo criterio que `estado_pedido_operativo`
-- (20261020000000): la lista vive en UN sitio, las RPC la comparten, y añadir
-- una etapa o un empaque no obliga a tocar un CHECK de la tabla —que exigiría
-- reescribir la restricción sobre las 30 000 filas de `sales` para nada—.
create or replace function public.etapa_empaque_valida(e text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select e in ('preparado', 'calidad', 'sellado', 'recolectado');
$$;

comment on function public.etapa_empaque_valida(text) is
  'Las cuatro etapas de la mesa de empaque. Espejo de ETAPAS_EMPAQUE en lib/catalogos.ts.';

create or replace function public.empaque_valido(e text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select e in ('caja', 'bolsa_chica', 'bolsa_mediana', 'bolsa_grande', 'sobre', 'tarima');
$$;

comment on function public.empaque_valido(text) is
  'Los empaques que se manejan en bodega. Espejo de EMPAQUES en lib/catalogos.ts.';

-- ------------------------------------------------------ 3. mover en el tablero
-- Por qué `security definer` y no un UPDATE desde el cliente: la RLS de
-- 20260805000100 reserva a dirección la edición de las ventas `origen = 'api'`
-- —y HOY TODOS los pedidos pendientes lo son—. Un UPDATE que la RLS descarta no
-- da error: PostgREST responde 204 con cero filas y el toast sale verde. Ya pasó
-- una vez, con el selector de estado (ver la cabecera de 20261020000000); esta
-- función es la misma puerta estrecha, para la columna nueva.
--
-- Además del tablero mueve `sales.estado`, y SIEMPRE a través de
-- `avanzar_estado_pedido` (20260926000200), que solo deja subir:
--
--   · calidad / sellado → 'preparando'  (alguien ya le metió mano)
--   · recolectado       → 'enviado'     (el transportista se lo llevó)
--
-- Ese rodeo es lo que hace que arrastrar una tarjeta HACIA ATRÁS —porque la caja
-- se abrió, porque faltaba una pieza— corrija la etapa de la mesa sin desandar
-- lo que el canal ya dio por hecho. Un pedido que Mercado Libre ya reporta
-- "enviado" no vuelve a "preparando" porque alguien arrastró una tarjeta.
create or replace function public.mover_etapa_empaque(p_id uuid, p_etapa text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  entrante text;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede mover el tablero de empaque.'
      using errcode = 'check_violation';
  end if;
  if not public.etapa_empaque_valida(p_etapa) then
    raise exception 'Esa etapa de empaque no existe (%).', p_etapa
      using errcode = 'check_violation';
  end if;

  entrante := case p_etapa
                when 'recolectado' then 'enviado'
                when 'sellado'     then 'preparando'
                when 'calidad'     then 'preparando'
                else null           -- 'preparado' no mueve el estado del canal
              end;

  update public.sales
     set etapa_empaque    = p_etapa,
         etapa_empaque_en = now(),
         estado           = public.avanzar_estado_pedido(estado, entrante)
   where id = p_id
     -- Una venta cancelada no se empaca. Mismo cierre que `mover_estado_pedido`.
     and estado is distinct from 'cancelado';
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.mover_etapa_empaque(uuid, text) is
  'Mueve la etapa de la mesa de empaque y, de paso, avanza sales.estado (nunca lo retrocede). Devuelve filas tocadas.';

-- -------------------------------------------------------------- 4. el empaque
-- NULL vacía el campo: "todavía no se decide en qué va" es una respuesta
-- legítima, y obligar a elegir para poder corregirse no lo sería.
create or replace function public.guardar_empaque_pedido(p_id uuid, p_empaque text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  limpio text;
begin
  if not public.es_interno() then
    raise exception 'Solo el equipo interno puede editar el empaque.'
      using errcode = 'check_violation';
  end if;

  limpio := nullif(btrim(coalesce(p_empaque, '')), '');
  if limpio is not null and not public.empaque_valido(limpio) then
    raise exception 'Ese empaque no existe (%).', limpio
      using errcode = 'check_violation';
  end if;

  update public.sales set empaque = limpio where id = p_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.guardar_empaque_pedido(uuid, text) is
  'Escribe SOLO sales.empaque (NULL lo vacia) para cualquier interno. Devuelve filas tocadas.';

-- --------------------------------------------------------------- 5. permisos
-- `security definer` se salta la RLS, así que el EXECUTE es la única puerta: se
-- cierra para todos y se abre solo al token del navegador ya autenticado (la
-- guarda de rol vive dentro de cada función).
revoke all on function public.etapa_empaque_valida(text)             from public, anon;
revoke all on function public.empaque_valido(text)                   from public, anon;
revoke all on function public.mover_etapa_empaque(uuid, text)        from public, anon;
revoke all on function public.guardar_empaque_pedido(uuid, text)     from public, anon;

grant execute on function public.etapa_empaque_valida(text)          to authenticated, service_role;
grant execute on function public.empaque_valido(text)                to authenticated, service_role;
grant execute on function public.mover_etapa_empaque(uuid, text)     to authenticated, service_role;
grant execute on function public.guardar_empaque_pedido(uuid, text)  to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, DESPUÉS de este archivo)
-- ----------------------------------------------------------------------------
-- 1) Las tres columnas existen y `authenticated` las lee:
--
--      select column_name,
--             has_column_privilege('authenticated', 'public.sales', column_name, 'SELECT')
--        from information_schema.columns
--       where table_schema = 'public' and table_name = 'sales'
--         and column_name in ('etapa_empaque', 'etapa_empaque_en', 'empaque');
--
--    Esperado: tres filas, las tres en `true`. Si alguna sale `false`, /pedidos
--    devuelve "permission denied for table sales" y no dice qué columna.
--
-- 2) Las funciones son `security definer` y no las llama `anon`:
--
--      select p.proname, p.prosecdef, array_agg(a.rolname order by a.rolname)
--        from pg_proc p
--        join pg_namespace n on n.oid = p.pronamespace
--        left join aclexplode(p.proacl) x on x.privilege_type = 'EXECUTE'
--        left join pg_roles a on a.oid = x.grantee
--       where n.nspname = 'public'
--         and p.proname in ('mover_etapa_empaque', 'guardar_empaque_pedido')
--       group by 1, 2;
--
--    Esperado: prosecdef = true y, en la lista, `authenticated` y `service_role`
--    — nunca `anon` ni `public`.
--
-- 3) El estado NO retrocede al arrastrar hacia atrás. Con un pedido ya enviado:
--
--      select public.mover_etapa_empaque('<uuid>', 'preparado');
--      select estado, etapa_empaque from public.sales where id = '<uuid>';
--
--    Esperado: etapa_empaque = 'preparado' y estado sigue en 'enviado'.
--
-- 4) Con una sesión de bodega (rol `miembro`), desde /pedidos: arrastrar una
--    tarjeta y RECARGAR. Se queda donde se soltó. Y la llave del dinero sigue
--    puesta: un UPDATE directo de `monto` sobre una venta `origen = 'api'` con
--    esa misma sesión debe seguir tocando 0 filas.
-- ============================================================================
