-- ============================================================================
-- 20260831000000_full_caja_dimensiones_rastreo.sql — La caja medida y la guía
-- ----------------------------------------------------------------------------
-- Dos cosas del envío full que la hoja sí llevaba y el CRM no:
--
-- 1. Las dimensiones de la caja eran UN campo de texto libre ("40x30x20", "40 x
--    30 x 20 cm", lo que se escribiera). Así no se puede sumar volumen, ni
--    comparar contra los topes de la paquetería, ni cotizar: es una etiqueta.
--    Se parten en tres columnas numéricas —largo, ancho y alto, en centímetros,
--    el orden en que vienen las etiquetas de guía— al lado del peso, que ya
--    estaba numérico.
--
--    El texto que había se convierte aquí mismo. La columna vieja se borra SOLO
--    si todo se pudo convertir; si algún renglón trae algo que no son tres
--    números, se queda con un aviso en vez de tirar el dato a la basura.
--
-- 2. El envío no tenía cómo rastrearse. La hoja de bodega lleva por envío el ID
--    que da la plataforma, la paquetería, el tipo de envío, el número de
--    rastreo y para cuándo se espera que llegue; sin eso hay que ir a buscar el
--    correo de Amazon para saber dónde va la caja.
--
-- Idempotente: se puede pegar tal cual en el SQL Editor de Supabase.
-- ============================================================================

set lock_timeout = '10s';

-- ----------------------------------------------------------------------------
-- 1. La caja, medida.
-- ----------------------------------------------------------------------------
alter table public.envio_full_cajas
  add column if not exists largo_cm numeric(6,2) check (largo_cm >= 0),
  add column if not exists ancho_cm numeric(6,2) check (ancho_cm >= 0),
  add column if not exists alto_cm  numeric(6,2) check (alto_cm  >= 0);

comment on column public.envio_full_cajas.largo_cm is 'Largo de la caja en cm.';
comment on column public.envio_full_cajas.ancho_cm is 'Ancho de la caja en cm.';
comment on column public.envio_full_cajas.alto_cm  is 'Alto de la caja en cm.';

do $$
declare
  sin_convertir int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'envio_full_cajas'
       and column_name  = 'dimensiones'
  ) then
    return;  -- ya se corrió antes: no hay nada que convertir.
  end if;

  -- Tres números separados por x, × o *, con o sin decimales, con o sin "cm".
  -- La coma se normaliza a punto porque en el piso se escribe "40,5".
  update public.envio_full_cajas c
     set largo_cm = (p.m)[1]::numeric,
         ancho_cm = (p.m)[2]::numeric,
         alto_cm  = (p.m)[3]::numeric
    from (
      select id,
             regexp_match(
               replace(dimensiones, ',', '.'),
               '([0-9]+(?:\.[0-9]+)?)\s*[x×*]\s*([0-9]+(?:\.[0-9]+)?)\s*[x×*]\s*([0-9]+(?:\.[0-9]+)?)',
               'i'
             ) as m
        from public.envio_full_cajas
       where dimensiones is not null
    ) p
   where c.id = p.id
     and p.m is not null
     and c.largo_cm is null and c.ancho_cm is null and c.alto_cm is null;

  select count(*) into sin_convertir
    from public.envio_full_cajas
   where nullif(btrim(dimensiones), '') is not null
     and largo_cm is null and ancho_cm is null and alto_cm is null;

  if sin_convertir = 0 then
    alter table public.envio_full_cajas drop column dimensiones;
  else
    raise notice
      '% caja(s) traen dimensiones que no son tres números: la columna «dimensiones» se conserva. Revísalas con: select id, dimensiones from public.envio_full_cajas where largo_cm is null and dimensiones is not null;',
      sin_convertir;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. El envío, rastreable. Todo es captura manual: el CRM no habla con Amazon
--    ni con la paquetería, solo guarda lo que la hoja ya llevaba a mano.
-- ----------------------------------------------------------------------------
alter table public.envios_full
  add column if not exists id_plataforma          text,
  add column if not exists paqueteria             text,
  add column if not exists tipo_envio             text,
  add column if not exists num_guia               text,
  add column if not exists fecha_llegada_estimada date;

comment on column public.envios_full.id_plataforma is
  'ID del envío en la plataforma (Shipment ID de Amazon / ID de envío de ML). Texto: no se consulta ninguna API con él.';
comment on column public.envios_full.paqueteria is
  'Transportista que lleva la caja al centro. Texto libre; el catálogo PAQUETERIAS solo sugiere.';
comment on column public.envios_full.tipo_envio is
  'Terrestre, aéreo… tal como lo cotizó la paquetería.';
comment on column public.envios_full.num_guia is
  'Número de rastreo. Mismo nombre que en sales para que urlRastreo() sirva igual.';
comment on column public.envios_full.fecha_llegada_estimada is
  'Fecha estimada de llegada al centro, la que promete la paquetería. No es la de recepción real.';

notify pgrst, 'reload schema';
