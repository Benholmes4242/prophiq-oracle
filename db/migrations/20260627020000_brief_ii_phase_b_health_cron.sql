-- Brief II Phase B: cron schedules for the health check + notification digest.
-- Follows the exact prophiq_call_edge pattern from 20260601010000_cron.sql.
-- Crons depend on Vault secrets prophiq_supabase_url and prophiq_service_role_key
-- (or the legacy app.prophiq.service_role_key GUC, depending on which
-- prophiq_service_key/prophiq_edge_url variant is active in this database).

-- ------------------------------------------------------------
-- health-check: every 5 minutes, probes all enabled checks.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_health_check()
RETURNS bigint
LANGUAGE sql
AS $$
  SELECT public.prophiq_call_edge('health-check', '{}'::jsonb);
$$;

SELECT cron.schedule(
  'prophiq_health_check',
  '*/5 * * * *',
  $$SELECT public.cron_health_check();$$
);

-- ------------------------------------------------------------
-- notification-digest: every 30 minutes. Edge fn skips if nothing pending.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_notification_digest()
RETURNS bigint
LANGUAGE sql
AS $$
  SELECT public.prophiq_call_edge('notification-digest', '{}'::jsonb);
$$;

SELECT cron.schedule(
  'prophiq_notification_digest',
  '*/30 * * * *',
  $$SELECT public.cron_notification_digest();$$
);
