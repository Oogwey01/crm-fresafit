-- Quién lleva cada personalizado. La tabla no lo decía y los personalizados los
-- atienden dos personas (Juanpi y Ulises): al repartir la chamba o preguntar
-- "¿quién trae el de Fulano?" había que ir al grupo de WhatsApp a deducirlo.
-- Anulable: los históricos quedan sin responsable y no estorban.
alter table public.personalizados
  add column if not exists responsable_id uuid references public.profiles(id) on delete set null;
