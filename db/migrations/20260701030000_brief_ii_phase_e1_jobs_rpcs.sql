-- Brief II Phase E.1 - jobs dashboard RPCs.

-- ============================================================
-- Static catalog of known jobs (name + schedule). Used to LEFT JOIN
-- cron_run_metrics so a job that has never run still appears.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_known_jobs()
RETURNS TABLE(job_name text, schedule text)
LANGUAGE sql STABLE
AS $$
  VALUES
    ('prophiq_discover_events',       '0 */4 * * *'),
    ('prophiq_generate_predictions',  '5 * * * *'),
    ('prophiq_score_predictions',     '15 * * * *'),
    ('prophiq_health_check',          '*/5 * * * *'),
    ('prophiq_notification_digest',   '*/30 * * * *'),
    ('refresh-calibration-buckets',   '0 */6 * * *'),
    ('refresh-calibration-curves',    '0 2 * * 0'),
    ('refresh-homepage-picks-daily',  '0 6 * * *')
$$;
GRANT EXECUTE ON FUNCTION public.admin_known_jobs() TO authenticated;

-- ============================================================
-- admin_cron_overview
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_cron_overview()
RETURNS TABLE (
  job_name text,
  schedule text,
  paused boolean,
  last_ran_at timestamptz,
  last_status text,
  last_duration_ms int,
  last_items_processed int,
  success_rate_30d numeric,
  avg_duration_ms_30d numeric,
  run_count_30d int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN QUERY
  WITH known AS (
    SELECT * FROM public.admin_known_jobs()
  ),
  recent AS (
    SELECT
      m.job_name,
      m.ran_at,
      m.status,
      m.duration_ms,
      m.items_processed,
      ROW_NUMBER() OVER (PARTITION BY m.job_name ORDER BY m.ran_at DESC) AS rn
    FROM public.cron_run_metrics m
    WHERE m.ran_at > now() - interval '30 days'
  ),
  last_run AS (
    SELECT job_name, ran_at, status, duration_ms, items_processed
    FROM recent WHERE rn = 1
  ),
  agg AS (
    SELECT
      job_name,
      COUNT(*)::int AS run_count,
      AVG(NULLIF(duration_ms, 0))::numeric(12,1) AS avg_dur,
      (SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END)::numeric
         / NULLIF(COUNT(*), 0)) AS success
    FROM recent
    GROUP BY job_name
  )
  SELECT
    k.job_name::text,
    k.schedule::text,
    COALESCE(s.paused, false),
    lr.ran_at,
    lr.status::text,
    lr.duration_ms,
    lr.items_processed,
    a.success,
    a.avg_dur,
    COALESCE(a.run_count, 0)
  FROM known k
  LEFT JOIN public.cron_job_state s ON s.job_name = k.job_name
  LEFT JOIN last_run lr ON lr.job_name = k.job_name
  LEFT JOIN agg a       ON a.job_name = k.job_name
  ORDER BY k.job_name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_cron_overview() TO authenticated;

-- ============================================================
-- admin_cron_runs - history for one job
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_cron_runs(
  p_job_name text, p_limit int DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  ran_at timestamptz,
  status text,
  duration_ms int,
  items_processed int,
  detail jsonb,
  error_message text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN QUERY
    SELECT
      m.id, m.ran_at, m.status::text, m.duration_ms,
      m.items_processed, m.detail, m.error_message
    FROM public.cron_run_metrics m
    WHERE m.job_name = p_job_name
    ORDER BY m.ran_at DESC
    LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_cron_runs(text, int) TO authenticated;

-- ============================================================
-- admin_run_cron_job - manual trigger for the pure-SQL jobs.
-- Edge-function jobs are triggered from the frontend (so the bearer is
-- the admin's session, not the service-role key on a SECURITY DEFINER).
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_run_cron_job(p_job_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_started timestamptz := clock_timestamp();
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin']);

  IF p_job_name NOT IN (
    'refresh-calibration-buckets',
    'refresh-calibration-curves',
    'refresh-homepage-picks-daily'
  ) THEN
    RAISE EXCEPTION 'admin_run_cron_job only supports SQL refresh jobs; use the frontend edge invoke for %', p_job_name;
  END IF;

  PERFORM public.log_admin_action(
    'cron.manual_trigger', 'cron_job', NULL,
    NULL,
    jsonb_build_object('job_name', p_job_name),
    jsonb_build_object('manual', true)
  );

  IF p_job_name = 'refresh-calibration-buckets' THEN
    PERFORM public.cron_refresh_calibration_buckets();
  ELSIF p_job_name = 'refresh-calibration-curves' THEN
    PERFORM public.cron_refresh_calibration_curves();
  ELSIF p_job_name = 'refresh-homepage-picks-daily' THEN
    PERFORM public.cron_refresh_homepage_picks_daily();
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'job_name', p_job_name,
    'duration_ms', GREATEST(0, EXTRACT(MILLISECONDS FROM clock_timestamp() - v_started)::int)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_run_cron_job(text) TO authenticated;

-- ============================================================
-- admin_set_cron_active - pause/resume via cron_job_state flag.
-- Wrappers consult is_cron_paused() at the top and no-op when paused.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_set_cron_active(
  p_job_name text, p_active boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_before boolean;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin']);

  IF NOT EXISTS (SELECT 1 FROM public.admin_known_jobs() j WHERE j.job_name = p_job_name) THEN
    RAISE EXCEPTION 'Unknown job: %', p_job_name;
  END IF;

  v_admin_id := public.admin_caller_id();
  SELECT paused INTO v_before FROM public.cron_job_state WHERE job_name = p_job_name;

  INSERT INTO public.cron_job_state (job_name, paused, updated_at, updated_by)
  VALUES (p_job_name, NOT p_active, now(), v_admin_id)
  ON CONFLICT (job_name) DO UPDATE
    SET paused = EXCLUDED.paused,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;

  PERFORM public.log_admin_action(
    CASE WHEN p_active THEN 'cron.resume' ELSE 'cron.pause' END,
    'cron_job', NULL,
    jsonb_build_object('job_name', p_job_name, 'paused', COALESCE(v_before, false)),
    jsonb_build_object('job_name', p_job_name, 'paused', NOT p_active),
    '{}'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_cron_active(text, boolean) TO authenticated;
