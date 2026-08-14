-- ============================================================================
-- Aviso de gasto fijo por vencer (audio de Armando, 13/08/2026): «agregar
-- notificaciones push para el teléfono» de sus pagos fijos personales.
--
-- La infraestructura de push ya existe (web-push + push_subscriptions +
-- despacharPushPendientes barre `notifications`); lo único que falta es que el
-- tipo 'gasto_fijo' quepa en el check. El aviso lo genera el barrido de
-- /api/tareas/recordatorios (cron externo) SOLO para el dueño de la sección
-- personal, sin task_id — la campana ya tolera avisos sin tarea.
-- Idempotente.
-- ============================================================================

alter table public.notifications drop constraint if exists notifications_tipo_check;
alter table public.notifications
  add constraint notifications_tipo_check
  check (tipo in ('asignacion','recordatorio','atorado','comentario','gasto_fijo'));
