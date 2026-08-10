-- ============================================================================
-- 20260926000100_maquila_guias.sql
--   "Favor de entregar guía": el pendiente de logística sobre un pedido listo.
-- ----------------------------------------------------------------------------
-- Eduardo no tiene cuenta en la paquetería y conectar una API se descartó por
-- ahora: la guía se la manda Fresa Fit ya hecha y él "nomás la imprime". Eso
-- es un pendiente de OTRA persona sobre un pedido que ya está terminado, no un
-- estado del pedido — por eso vive aquí y no en el enum de maquila_pedidos:
--
--   * el enum es una cadena monótona que valida un trigger por rangos; meterle
--     un peldaño obligaría a renumerar con pedidos vivos en producción;
--   * y sobre todo, Eduardo no puede "avanzar" a un estado que depende de que
--     alguien más suba un archivo. El tablero se le quedaría trabado.
--
-- La guía es del PAQUETE, no del renglón: una orden con tres cinturones lleva
-- una sola guía. De ahí `grupo` = referencia_orden (o el id del pedido cuando
-- es captura manual suelta) y el índice único parcial, que evita que dos
-- renglones hermanos terminados con segundos de diferencia abran dos
-- solicitudes para el mismo paquete.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.maquila_guias (
  id             uuid primary key default gen_random_uuid(),

  -- Identidad del paquete. Mismo canal que el pedido; `grupo` es
  -- coalesce(referencia_orden, pedido_id::text).
  canal          text not null check (canal in ('tienda_nube','mercado_libre','manual')),
  grupo          text not null,

  estado         text not null default 'solicitada'
                 check (estado in ('solicitada','cargada','entregada','cancelada')),

  -- Lo que Eduardo pega en la caja. Mismos nombres que sales/maquila_pedidos.
  paqueteria     text,
  num_guia       text,

  -- El PDF o la imagen que él imprime. Bucket `maquila`, guias/<id>/<archivo>.
  archivo_path   text,
  archivo_nombre text,
  archivo_mime   text,

  solicitada_en  timestamptz not null default now(),
  cargada_por    uuid references public.profiles(id) on delete set null,
  cargada_en     timestamptz,
  entregada_en   timestamptz,

  notas          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.maquila_guias is
  'Solicitudes de guía de maquila: una por PAQUETE (canal + orden). La abre el trigger al terminarse el pedido, la surte logística subiendo el archivo, y se cierra sola cuando el paquete sale.';
comment on column public.maquila_guias.grupo is
  'coalesce(referencia_orden, pedido_id::text): agrupa los renglones hermanos de una misma orden bajo una sola guía.';

-- Una sola solicitud VIVA por paquete. Parcial: cerrada la primera, un
-- reenvío puede abrir otra sin chocar con el histórico.
create unique index if not exists maquila_guias_abierta_uidx
  on public.maquila_guias (canal, grupo)
  where estado in ('solicitada','cargada');

create index if not exists maquila_guias_estado_idx on public.maquila_guias (estado, solicitada_en);
-- Higiene de FKs (ver 20260825000000_indices.sql).
create index if not exists maquila_guias_cargada_por_idx on public.maquila_guias (cargada_por);

drop trigger if exists maquila_guias_touch_trg on public.maquila_guias;
create trigger maquila_guias_touch_trg
  before update on public.maquila_guias
  for each row execute function public.maquila_touch();

-- ---------------------------------------------------------------------------
-- El ciclo, disparado por el propio pedido.
--
-- AFTER UPDATE y escribiendo SOLO en maquila_guias: no puede reentrar en
-- validar_cambio_maquila ni disparar de nuevo este mismo trigger. Es la misma
-- razón por la que log_evento_maquila es AFTER.
--
-- `security definer` porque quien mueve el pedido a `terminado` suele ser el
-- maquilero, y su RLS no le da INSERT sobre esta tabla — ni se lo va a dar:
-- pedir la guía no es un acto suyo, es una consecuencia.
-- ---------------------------------------------------------------------------
create or replace function public.solicitar_guia_maquila()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_grupo text := coalesce(nullif(btrim(coalesce(new.referencia_orden, '')), ''), new.id::text);
begin
  -- Abre el pendiente al terminar, salvo que el paquete ya traiga guía (guía
  -- capturada a mano por el camino de respaldo, o renglón hermano ya surtido).
  if new.estado = 'terminado' and old.estado is distinct from 'terminado'
     and nullif(btrim(coalesce(new.num_guia, '')), '') is null
  then
    insert into public.maquila_guias (canal, grupo)
      values (new.canal, v_grupo)
      on conflict do nothing;   -- lo frena maquila_guias_abierta_uidx
  end if;

  -- Y lo cierra cuando el paquete sale.
  if new.estado = 'enviado' and old.estado is distinct from 'enviado' then
    update public.maquila_guias
       set estado = 'entregada', entregada_en = now()
     where canal = new.canal and grupo = v_grupo
       and estado in ('solicitada','cargada');
  end if;

  return new;
end;
$$;

drop trigger if exists maquila_pedidos_guia_trg on public.maquila_pedidos;
create trigger maquila_pedidos_guia_trg
  after update on public.maquila_pedidos
  for each row execute function public.solicitar_guia_maquila();

-- ---------------------------------------------------------------------------
-- Permisos + RLS.
--   Interno: ve y surte (logística sube el archivo y el número).
--   Maquilero: solo LEE, y solo las de paquetes que su propia RLS le deja ver.
--   Borrar: nadie. Cancelada es un estado.
-- ---------------------------------------------------------------------------
grant all on public.maquila_guias to authenticated, service_role;

alter table public.maquila_guias enable row level security;

drop policy if exists "maquila guias: ver (interno)" on public.maquila_guias;
create policy "maquila guias: ver (interno)" on public.maquila_guias
  for select to authenticated using ((select public.es_interno()));

drop policy if exists "maquila guias: ver (maquilero)" on public.maquila_guias;
create policy "maquila guias: ver (maquilero)" on public.maquila_guias
  for select to authenticated
  using (
    (select public.es_maquilero())
    and exists (
      select 1 from public.maquila_pedidos p
       where p.canal = maquila_guias.canal
         and coalesce(nullif(btrim(coalesce(p.referencia_orden, '')), ''), p.id::text) = maquila_guias.grupo
         and p.estado <> 'esperando_pago'
    )
  );

drop policy if exists "maquila guias: crear (interno)" on public.maquila_guias;
create policy "maquila guias: crear (interno)" on public.maquila_guias
  for insert to authenticated with check ((select public.es_interno()));

drop policy if exists "maquila guias: actualizar (interno)" on public.maquila_guias;
create policy "maquila guias: actualizar (interno)" on public.maquila_guias
  for update to authenticated
  using ((select public.es_interno()))
  with check ((select public.es_interno()));

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select policyname from pg_policies where tablename = 'maquila_guias';
--     -- 4: ver ×2, crear, actualizar
--   select tgname from pg_trigger
--    where tgrelid = 'public.maquila_pedidos'::regclass and not tgisinternal;
--     -- ahora CUATRO: touch, validar, log y guia
--   -- Cuántos paquetes esperan guía ahora mismo:
--   select estado, count(*) from public.maquila_guias group by estado;
-- ============================================================================
