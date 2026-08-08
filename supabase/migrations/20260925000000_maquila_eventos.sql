-- ============================================================================
-- 20260925000000_maquila_eventos.sql
--   Quién movió qué y cuándo: la auditoría del pedido de maquila.
-- ----------------------------------------------------------------------------
-- "Cada cambio de estado guarda fecha, hora y usuario. Sin excepción." — es
-- criterio de aceptación de la Fase 1, y en la Fase 2 es la materia prima del
-- registro de incidencias: probar con datos si el retraso fue de Eduardo o de
-- su bordador, y negociar con evidencia en vez de percepciones.
--
-- Lo escribe un trigger (precedente: log_actividad_tarea) y NO el código de la
-- app: así también los cambios de la ingesta y cualquier corrección manual por
-- SQL quedan registrados. `autor` null = proceso sin persona (webhook, cron).
--
-- Append-only como stock_log: sin policies de update/delete, y sin policy de
-- insert siquiera — el único escritor es el trigger (security definer). NO
-- entra a purgar_logs(): es auditoría exigida por la operación y el corte
-- quincenal de pago puede necesitar historia vieja.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

create table if not exists public.maquila_eventos (
  id         bigint generated always as identity primary key,
  pedido_id  uuid not null references public.maquila_pedidos(id) on delete cascade,
  autor      uuid references public.profiles(id) on delete set null,
  tipo       text not null check (tipo in ('creacion','pago','estado','subestado',
                                           'guia','reclasificacion','cancelacion')),
  de         text,
  a          text,
  detalle    text,
  created_at timestamptz not null default now()
);

comment on table public.maquila_eventos is
  'Auditoría append-only de maquila_pedidos, escrita solo por trigger. Autor null = sistema (ingesta/cron). No se purga: es la evidencia de cumplimiento.';

create index if not exists maquila_ev_pedido_idx on public.maquila_eventos (pedido_id, created_at desc);
create index if not exists maquila_ev_autor_idx  on public.maquila_eventos (autor, created_at desc);

-- ---------------------------------------------------------------------------
-- El único escritor. AFTER para no interferir con la validación BEFORE; cada
-- aspecto del cambio genera su propio renglón, que el diálogo pinta como
-- historia legible.
-- ---------------------------------------------------------------------------
create or replace function public.log_evento_maquila()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.maquila_eventos (pedido_id, autor, tipo, a, detalle)
      values (new.id, coalesce(new.created_by, auth.uid()), 'creacion', new.estado,
              case new.canal
                when 'manual' then 'captura manual'
                else 'orden ' || coalesce(new.numero_orden, new.referencia_orden, '¿?')
                       || ' de ' || new.canal
              end);
    return new;
  end if;

  -- UPDATE
  if new.pagado_en is not null and old.pagado_en is null then
    insert into public.maquila_eventos (pedido_id, autor, tipo, a, detalle)
      values (new.id, auth.uid(), 'pago', new.pagado_en::text,
              'promesa: ' || coalesce(new.fecha_prometida::text, '¿?')
                || case when new.corte_fecha is not null
                        then ', corte del ' || new.corte_fecha::text
                        else ', producción directa' end);
  end if;

  if new.estado is distinct from old.estado then
    insert into public.maquila_eventos (pedido_id, autor, tipo, de, a)
      values (new.id, auth.uid(),
              case when new.estado in ('cancelado','devuelto') then 'cancelacion' else 'estado' end,
              old.estado, new.estado);
  end if;

  if new.subestado is distinct from old.subestado and new.subestado is not null then
    insert into public.maquila_eventos (pedido_id, autor, tipo, de, a)
      values (new.id, auth.uid(), 'subestado', old.subestado, new.subestado);
  end if;

  if new.num_guia is distinct from old.num_guia and new.num_guia is not null then
    insert into public.maquila_eventos (pedido_id, autor, tipo, de, a, detalle)
      values (new.id, auth.uid(), 'guia', old.num_guia, new.num_guia, new.paqueteria);
  end if;

  -- Reclasificación: cambió la promesa sin que fuera el momento del pago
  -- (corrección manual, cierre de taller sobrevenido).
  if new.fecha_prometida is distinct from old.fecha_prometida
     and old.pagado_en is not null
  then
    insert into public.maquila_eventos (pedido_id, autor, tipo, de, a)
      values (new.id, auth.uid(), 'reclasificacion',
              old.fecha_prometida::text, new.fecha_prometida::text);
  end if;

  return new;
end;
$$;

drop trigger if exists maquila_pedidos_log_trg on public.maquila_pedidos;
create trigger maquila_pedidos_log_trg
  after insert or update on public.maquila_pedidos
  for each row execute function public.log_evento_maquila();

-- ---------------------------------------------------------------------------
-- Permisos + RLS: lee el equipo interno completo; el maquilero, solo la
-- historia de los pedidos que su propia RLS le deja ver. Nadie inserta ni
-- edita a mano: el trigger (definer) es el único camino.
-- ---------------------------------------------------------------------------
grant all on public.maquila_eventos to authenticated, service_role;

alter table public.maquila_eventos enable row level security;

drop policy if exists "maquila eventos: ver (interno)" on public.maquila_eventos;
create policy "maquila eventos: ver (interno)" on public.maquila_eventos
  for select to authenticated using ((select public.es_interno()));

drop policy if exists "maquila eventos: ver (maquilero)" on public.maquila_eventos;
create policy "maquila eventos: ver (maquilero)" on public.maquila_eventos
  for select to authenticated
  using (
    (select public.es_maquilero())
    and exists (
      select 1 from public.maquila_pedidos p
       where p.id = pedido_id and p.estado <> 'esperando_pago'
    )
  );

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (pegar aparte, después)
-- ----------------------------------------------------------------------------
--   select tgname from pg_trigger
--    where tgrelid = 'public.maquila_pedidos'::regclass and not tgisinternal;
--     -- deben salir TRES: touch, validar y log
--   select policyname from pg_policies where tablename = 'maquila_eventos';
--     -- solo las dos de select: nadie escribe salvo el trigger
-- ============================================================================
