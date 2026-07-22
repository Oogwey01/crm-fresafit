-- ============================================================================
-- Fresafit CRM — Fotos propias de producto (subidas a mano desde el CRM)
-- ----------------------------------------------------------------------------
--   products.imagen_url / products.imagenes guardan la galería IMPORTADA de
--   Tienda Nube y Mercado Libre, y cada sincronización las reescribe completas.
--   Por eso las fotos que se suben a mano viven aparte, en esta tabla: así la
--   sync de los canales nunca las pisa.
--
--   El bucket es PÚBLICO (a diferencia de `adjuntos` y `facturas`, privados por
--   sensibles): son fotos de catálogo que ya se publican en las tiendas, y así
--   se sirven con URL directa igual que las del CDN de los canales, sin firmar.
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

create table if not exists public.product_photos (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references public.products(id) on delete cascade,
  nombre       text not null,
  storage_path text not null,
  tipo         text,
  orden        int  not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists product_photos_producto_idx on public.product_photos(producto_id);

insert into storage.buckets (id, name, public)
values ('fotos-productos', 'fotos-productos', true)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- RLS: mismo criterio que `products` — los internos ven y editan. El borrado no
-- se reserva a gestor (a diferencia de borrar el producto entero) para que quien
-- sube una foto equivocada pueda quitarla.
-- ----------------------------------------------------------------------------
grant all on public.product_photos to authenticated, service_role;

alter table public.product_photos enable row level security;

drop policy if exists "fotos producto: ver (interno)" on public.product_photos;
create policy "fotos producto: ver (interno)" on public.product_photos
  for select to authenticated using (public.es_interno());

drop policy if exists "fotos producto: crear (interno)" on public.product_photos;
create policy "fotos producto: crear (interno)" on public.product_photos
  for insert to authenticated with check (public.es_interno());

drop policy if exists "fotos producto: borrar (interno)" on public.product_photos;
create policy "fotos producto: borrar (interno)" on public.product_photos
  for delete to authenticated using (public.es_interno());

-- Storage del bucket `fotos-productos`: lectura abierta (el bucket es público),
-- escritura solo para internos.
drop policy if exists "fotos producto storage: ver" on storage.objects;
create policy "fotos producto storage: ver" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'fotos-productos');

drop policy if exists "fotos producto storage: subir (interno)" on storage.objects;
create policy "fotos producto storage: subir (interno)" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-productos' and public.es_interno());

drop policy if exists "fotos producto storage: borrar (interno)" on storage.objects;
create policy "fotos producto storage: borrar (interno)" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-productos' and public.es_interno());

notify pgrst, 'reload schema';
