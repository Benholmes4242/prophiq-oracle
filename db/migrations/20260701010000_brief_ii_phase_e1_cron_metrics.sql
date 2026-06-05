-- Brief II Phase E.1 - cron observability foundation:
-- cron_run_metrics + log_cron_run + cron_job_state.

-- ============================================================
-- 1. cron_run_metrics
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cron_run_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  duration_ms int,
  status text NOT NULL CHECK (status IN ('succeeded','failed','partial','started','skipped')),
  items_processed int,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_run_metrics_job_ran
  ON public.cron_run_metrics(job_name, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_run_metrics_ran
  ON public.cron_run_metrics(ran_at DESC);

GRANT SELECT ON public.cron_run_metrics TO authenticated;
GRANT ALL    ON public.cron_run_metrics TO service_role;

ALTER TABLE public.cron_run_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cron_run_metrics_admin_read ON public.cron_run_metrics;
CREATE POLICY cron_run_metrics_admin_read
  ON public.cron_run_metrics FOR SELECT TO authenticated
  USING (public.is_admin());
-- No INSERT/UPDATE policy: writes via SECURITY DEFINER helper or service_role.

-- ============================================================
-- 2. log_cron_run helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_cron_run(
  p_job_name text,
  p_status text,
  p_duration_ms int DEFAULT NULL,
  p_items_processed int DEFAULT NULL,
  p_detail jsonb DEFAULT '{}'::jsonb,
  p_error_message text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.cron_run_metrics
    (job_name, status, duration_ms, items_processed, detail, error_message)
  VALUES
    (p_job_name, p_status, p_duration_ms, p_items_processed,
     COALESCE(p_detail, '{}'::jsonb), p_error_message)
  RETURNING id INTO v_id;

  -- Opportunistic GC: keep ~30 days.
  DELETE FROM public.cron_run_metrics
  WHERE ran_at < now() - interval '30 days';

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_cron_run(text,text,int,int,jsonb,text)
  TO service_role, authenticated;

-- ============================================================
-- 3. cron_job_state (pause flag, version-independent)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cron_job_state (
  job_name text PRIMARY KEY,
  paused boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.admin_users(id)
);

GRANT SELECT ON public.cron_job_state TO authenticated;
GRANT ALL    ON public.cron_job_state TO service_role;

ALTER TABLE public.cron_job_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cron_job_state_admin_read ON public.cron_job_state;
CREATE POLICY cron_job_state_admin_read
  ON public.cron_job_state FOR SELECT TO authenticated
  USING (public.is_admin());

-- Seed unpaused rows for all 8 known jobs so the read path always finds a row.
INSERT INTO public.cron_job_state (job_name, paused) VALUES
  ('prophiq_discover_events', false),
  ('prophiq_generate_predictions', false),
  ('prophiq_score_predictions', false),
  ('prophiq_health_check', false),
  ('prophiq_notification_digest', false),
  ('refresh-calibration-buckets', false),
  ('refresh-calibration-curves', false),
  ('refresh-homepage-picks-daily', false)
ON CONFLICT (job_name) DO NOTHING;

-- ============================================================
-- 4. Helper: is_cron_paused (read by every wrapper at top)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_cron_paused(p_job_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT paused FROM public.cron_job_state WHERE job_name = p_job_name),
    false
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_cron_paused(text)
  TO service_role, authenticated;
