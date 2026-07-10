-- ============================================================================
-- supabase/seed.sql — SOLO para el stack local (`supabase db reset`).
-- En el Supabase local los privilegios por defecto no le dan DML al
-- service_role (a diferencia del proyecto en la nube), así que los scripts
-- de seed fallarían con "permission denied". En vivo esto ya existe.
-- ============================================================================
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
