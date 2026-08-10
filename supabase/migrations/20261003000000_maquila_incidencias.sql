-- ============================================================================
-- 20261003000000_maquila_incidencias.sql
--   «Oye, este cinto está mal»: lo que se reporta de un pedido.
-- ----------------------------------------------------------------------------
-- El campo `notas` del pedido sirve para acordarse de algo, no para llevar un
-- pendiente: no se puede cerrar, no se sabe de quién es y se pisa al editar.
-- Una incidencia sí: nace abierta, alguien la resuelve, y queda.
--
-- Es de doble sentido, que es la parte que importa:
--   * el equipo le dice a Eduardo que una pieza salió mal;
--   * Eduardo avisa que falta material, que el arte no se entiende o que su
--     imprenta lo dejó colgado —y eso es exactamente la evidencia con la que
--     después se discute de quién fue el retraso—.
--
-- Él ABRE pero no resuelve: cerrar un pendiente que te reclaman a ti no es
-- tuyo. Calcado de supplier_order_incidents (20260731000000).
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.maquila_incidencias (
  id           uuid primary key default gen_random_uuid(),
  pedido_id    uuid not null references public.maquila_pedidos(id) on delete cascade,
  tipo         text not null default 'otro'
               check (tipo in ('calidad','retraso','faltante','diseno','otro')),
  -- A quién le toca resolverla. No da permisos: es para saber de quién es.
  dirigida_a   text not null default 'equipo'
               check (dirigida_a in ('equipo','maquilero','diseno')),
  texto        text not null,
  abierta      boolean not null default true,
  resuelta_en  timestamptz,
  resuelta_por uuid references public.profiles(id) on delete set null,
  respuesta    text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.maquila_incidencias is
  'Pendientes sobre un pedido de maquila, en ambos sentidos. El maquilero abre y comenta; resolver es del equipo.';

create index if not exists maquila_inc_pedido_idx  on public.maquila_incidencias (pedido_id, created_at desc);
create index if not exists maquila_inc_abierta_idx on public.maquila_incidencias (abierta, created_at desc);
create index if not exists maquila_inc_autor_idx   on public.maquila_incidencias (created_by);
create index if not exists maquila_inc_resuelta_idx on public.maquila_incidencias (resuelta_por);

-- ---------------------------------------------------------------------------
-- Permisos + RLS.
--   Interno: todo.
--   Maquilero: ve las de sus pedidos y puede abrir las suyas. Ni edita ni
--   borra: una incidencia reportada no se retira, se resuelve.
-- ---------------------------------------------------------------------------
grant all on public.maquila_incidencias to authenticated, service_role;

alter table public.maquila_incidencias enable row level security;

drop policy if exists "maquila incidencias: ver (interno)" on public.maquila_incidencias;
create policy "maquila incidencias: ver (interno)" on public.maquila_incidencias
  for select to authenticated using ((select public.es_interno()));

drop policy if exists "maquila incidencias: gestionar (interno)" on public.maquila_incidencias;
create policy "maquila incidencias: gestionar (interno)" on public.maquila_incidencias
  for all to authenticated
  using ((select public.es_interno()))
  with check ((select public.es_interno()));

drop policy if exists "maquila incidencias: ver (maquilero)" on public.maquila_incidencias;
create policy "maquila incidencias: ver (maquilero)" on public.maquila_incidencias
  for select to authenticated
  using (
    (select public.es_maquilero())
    and exists (
      select 1 from public.maquila_pedidos p
       where p.id = pedido_id and p.estado <> 'esperando_pago'
    )
  );

drop policy if exists "maquila incidencias: abrir (maquilero)" on public.maquila_incidencias;
create policy "maquila incidencias: abrir (maquilero)" on public.maquila_incidencias
  for insert to authenticated
  with check (
    (select public.es_maquilero())
    and created_by = (select auth.uid())
    and abierta
    and exists (
      select 1 from public.maquila_pedidos p
       where p.id = pedido_id and p.estado <> 'esperando_pago'
    )
  );

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select policyname, cmd from pg_policies where tablename = 'maquila_incidencias';
--     -- 4: ver ×2, gestionar (interno), abrir (maquilero)
--   select tipo, count(*) filter (where abierta) as abiertas, count(*) as total
--     from public.maquila_incidencias group by 1;
-- ============================================================================
