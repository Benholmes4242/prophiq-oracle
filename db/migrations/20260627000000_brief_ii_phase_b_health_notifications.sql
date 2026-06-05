-- Brief II Phase B: Admin notifications + system health foundation.
-- Tables: admin_notifications, admin_notification_reads, health_checks,
--         health_check_runs.
-- RPCs:   raise_admin_notification, resolve_admin_notification_by_dedup,
--         admin_list_notifications, admin_mark_notifications_read,
--         admin_health_overview, admin_health_failures,
--         admin_forecast_volume, admin_dashboard_summary.
--
-- Every RETURNS TABLE casts varchar/enum columns to text to avoid
-- Postgres 42804 ("structure of query does not match function result type"),
-- matching the fix applied to admin_list_users on 2026-06-05.

-- ============================================================
-- 1. admin_notifications + admin_notification_reads
-- ============================================================
CREATE TABLE public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  category text NOT NULL,
  title text NOT NULL,
  body text,
  source text NOT NULL DEFAULT 'system',
  target_url text,
  dedup_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  digest_sent_at timestamptz
);

CREATE TABLE public.admin_notification_reads (
  notification_id uuid NOT NULL REFERENCES public.admin_notifications(id) ON DELETE CASCADE,
  admin_user_id   uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, admin_user_id)
);

CREATE INDEX idx_admin_notifications_created_at
  ON public.admin_notifications(created_at DESC);
CREATE INDEX idx_admin_notifications_unresolved
  ON public.admin_notifications(created_at DESC)
  WHERE resolved_at IS NULL;
CREATE UNIQUE INDEX idx_admin_notifications_dedup
  ON public.admin_notifications(dedup_key)
  WHERE dedup_key IS NOT NULL AND resolved_at IS NULL;
CREATE INDEX idx_admin_notifications_digest_pending
  ON public.admin_notifications(created_at)
  WHERE digest_sent_at IS NULL AND severity IN ('warning', 'critical');

GRANT SELECT          ON public.admin_notifications       TO authenticated;
GRANT SELECT, INSERT  ON public.admin_notification_reads  TO authenticated;
GRANT ALL             ON public.admin_notifications       TO service_role;
GRANT ALL             ON public.admin_notification_reads  TO service_role;

ALTER TABLE public.admin_notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notification_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_notifications_admin_read ON public.admin_notifications
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY admin_notification_reads_self ON public.admin_notification_reads
  FOR ALL TO authenticated
  USING (
    admin_user_id IN (
      SELECT id FROM public.admin_users
      WHERE user_id = auth.uid() AND revoked_at IS NULL
    )
  )
  WITH CHECK (
    admin_user_id IN (
      SELECT id FROM public.admin_users
      WHERE user_id = auth.uid() AND revoked_at IS NULL
    )
  );

-- ============================================================
-- 2. Notification RPCs
-- ============================================================

-- raise_admin_notification: insert with dedup. Returns the new id, or NULL
-- if suppressed by an open dedup_key.
CREATE OR REPLACE FUNCTION public.raise_admin_notification(
  p_severity   text,
  p_category   text,
  p_title      text,
  p_body       text  DEFAULT NULL,
  p_source     text  DEFAULT 'system',
  p_target_url text  DEFAULT NULL,
  p_dedup_key  text  DEFAULT NULL,
  p_metadata   jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  -- The partial unique index handles dedup. ON CONFLICT requires naming
  -- the index, which works for partial unique indexes via the column list +
  -- WHERE clause. Simpler approach: pre-check, then insert.
  IF p_dedup_key IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.admin_notifications
      WHERE dedup_key = p_dedup_key AND resolved_at IS NULL
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.admin_notifications
    (severity, category, title, body, source, target_url, dedup_key, metadata)
  VALUES
    (p_severity, p_category, p_title, p_body, p_source, p_target_url, p_dedup_key, p_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- resolve_admin_notification_by_dedup: clear an open condition. Returns rows
-- affected so callers can detect "we just resolved something".
CREATE OR REPLACE FUNCTION public.resolve_admin_notification_by_dedup(p_dedup_key text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n int;
BEGIN
  UPDATE public.admin_notifications
  SET resolved_at = now()
  WHERE dedup_key = p_dedup_key AND resolved_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- admin_list_notifications: feed for the bell. Returns recent notifications
-- with the caller's read state. unread_count is the same on every row so the
-- frontend can read it from row 0.
CREATE OR REPLACE FUNCTION public.admin_list_notifications(
  p_limit       int     DEFAULT 30,
  p_unread_only boolean DEFAULT false
)
RETURNS TABLE (
  id            uuid,
  severity      text,
  category      text,
  title         text,
  body          text,
  source        text,
  target_url    text,
  metadata      jsonb,
  created_at    timestamptz,
  resolved_at   timestamptz,
  is_read       boolean,
  unread_count  bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_admin_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT a.id INTO v_admin_id
  FROM public.admin_users a
  WHERE a.user_id = auth.uid() AND a.revoked_at IS NULL;

  RETURN QUERY
  WITH feed AS (
    SELECT
      n.id,
      n.severity,
      n.category,
      n.title,
      n.body,
      n.source,
      n.target_url,
      n.metadata,
      n.created_at,
      n.resolved_at,
      (r.notification_id IS NOT NULL) AS is_read
    FROM public.admin_notifications n
    LEFT JOIN public.admin_notification_reads r
      ON r.notification_id = n.id AND r.admin_user_id = v_admin_id
  ),
  unread AS (
    SELECT count(*) AS c FROM feed WHERE NOT is_read
  )
  SELECT
    f.id,
    f.severity::text,
    f.category::text,
    f.title::text,
    f.body::text,
    f.source::text,
    f.target_url::text,
    f.metadata,
    f.created_at,
    f.resolved_at,
    f.is_read,
    (SELECT c FROM unread) AS unread_count
  FROM feed f
  WHERE (NOT p_unread_only OR NOT f.is_read)
  ORDER BY f.created_at DESC
  LIMIT p_limit;
END;
$$;

-- admin_mark_notifications_read: mark one (or all if NULL) read for the caller.
CREATE OR REPLACE FUNCTION public.admin_mark_notifications_read(
  p_notification_id uuid DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_n int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT id INTO v_admin_id
  FROM public.admin_users
  WHERE user_id = auth.uid() AND revoked_at IS NULL;

  INSERT INTO public.admin_notification_reads (notification_id, admin_user_id)
  SELECT n.id, v_admin_id
  FROM public.admin_notifications n
  WHERE (p_notification_id IS NULL OR n.id = p_notification_id)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.raise_admin_notification(text,text,text,text,text,text,text,jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_admin_notification_by_dedup(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_notifications(int, boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_notifications_read(uuid)
  TO authenticated;

-- ============================================================
-- 3. health_checks + health_check_runs
-- ============================================================
CREATE TABLE public.health_checks (
  key                  text PRIMARY KEY,
  label                text NOT NULL,
  category             text NOT NULL CHECK (category IN ('llm', 'research', 'structured_data', 'infra', 'payments')),
  enabled              boolean NOT NULL DEFAULT true,
  critical             boolean NOT NULL DEFAULT false,
  expected_latency_ms  int,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.health_check_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_key   text NOT NULL REFERENCES public.health_checks(key) ON DELETE CASCADE,
  status      text NOT NULL CHECK (status IN ('ok', 'degraded', 'down', 'skipped')),
  latency_ms  int,
  detail      text,
  checked_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_health_check_runs_key_time
  ON public.health_check_runs(check_key, checked_at DESC);
CREATE INDEX idx_health_check_runs_time
  ON public.health_check_runs(checked_at DESC);

GRANT SELECT ON public.health_checks     TO authenticated;
GRANT SELECT ON public.health_check_runs TO authenticated;
GRANT ALL    ON public.health_checks     TO service_role;
GRANT ALL    ON public.health_check_runs TO service_role;

ALTER TABLE public.health_checks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_check_runs  ENABLE ROW LEVEL SECURITY;

CREATE POLICY health_checks_admin_read ON public.health_checks
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY health_check_runs_admin_read ON public.health_check_runs
  FOR SELECT TO authenticated USING (public.is_admin());

-- ============================================================
-- 4. Health read RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_health_overview(p_window_hours int DEFAULT 168)
RETURNS TABLE (
  key                  text,
  label                text,
  category             text,
  critical             boolean,
  enabled              boolean,
  expected_latency_ms  int,
  current_status       text,
  last_checked_at      timestamptz,
  last_detail          text,
  p50_latency_ms       int,
  p95_latency_ms       int,
  success_rate         numeric,
  run_count            bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH win AS (
    SELECT * FROM public.health_check_runs
    WHERE checked_at >= now() - make_interval(hours => p_window_hours)
  ),
  latest AS (
    SELECT DISTINCT ON (w.check_key)
      w.check_key, w.status, w.checked_at, w.detail
    FROM win w
    ORDER BY w.check_key, w.checked_at DESC
  ),
  stats AS (
    SELECT
      w.check_key,
      percentile_disc(0.5)  WITHIN GROUP (ORDER BY w.latency_ms)
        FILTER (WHERE w.latency_ms IS NOT NULL) AS p50,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY w.latency_ms)
        FILTER (WHERE w.latency_ms IS NOT NULL) AS p95,
      avg(CASE WHEN w.status = 'ok'      THEN 1.0
               WHEN w.status = 'skipped' THEN NULL
               ELSE 0.0 END) AS sr,
      count(*) AS rc
    FROM win w
    GROUP BY w.check_key
  )
  SELECT
    c.key::text,
    c.label::text,
    c.category::text,
    c.critical,
    c.enabled,
    c.expected_latency_ms,
    COALESCE(l.status, 'skipped')::text   AS current_status,
    l.checked_at                          AS last_checked_at,
    l.detail::text                        AS last_detail,
    s.p50::int                            AS p50_latency_ms,
    s.p95::int                            AS p95_latency_ms,
    ROUND(COALESCE(s.sr, 0)::numeric, 4)  AS success_rate,
    COALESCE(s.rc, 0)                     AS run_count
  FROM public.health_checks c
  LEFT JOIN latest l ON l.check_key = c.key
  LEFT JOIN stats  s ON s.check_key = c.key
  ORDER BY c.critical DESC, c.category, c.label;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_health_failures(p_limit int DEFAULT 50)
RETURNS TABLE (
  check_key   text,
  label       text,
  status      text,
  latency_ms  int,
  detail      text,
  checked_at  timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    r.check_key::text,
    c.label::text,
    r.status::text,
    r.latency_ms,
    r.detail::text,
    r.checked_at
  FROM public.health_check_runs r
  JOIN public.health_checks c ON c.key = r.check_key
  WHERE r.status IN ('down', 'degraded')
  ORDER BY r.checked_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_health_overview(int)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_health_failures(int)  TO authenticated;

-- ============================================================
-- 5. admin_forecast_volume
-- Per-day forecast count + Perplexity tokens. Reads research_tokens_used
-- directly from prediction_inputs (confirmed column, integer type).
-- Labeled "Forecast volume" on the dashboard, NOT a cost figure - true
-- cost attribution is Phase 7.D.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_forecast_volume(p_days int DEFAULT 7)
RETURNS TABLE (
  day                  date,
  prediction_count     bigint,
  perplexity_tokens    bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(
      date_trunc('day', now()) - make_interval(days => p_days - 1),
      date_trunc('day', now()),
      interval '1 day'
    )::date AS d
  )
  SELECT
    d.d AS day,
    COALESCE((
      SELECT count(*)
      FROM public.prediction_inputs pi
      WHERE pi.time_of_call >= d.d
        AND pi.time_of_call <  d.d + interval '1 day'
    ), 0)::bigint AS prediction_count,
    COALESCE((
      SELECT sum(pi.research_tokens_used)
      FROM public.prediction_inputs pi
      WHERE pi.time_of_call >= d.d
        AND pi.time_of_call <  d.d + interval '1 day'
    ), 0)::bigint AS perplexity_tokens
  FROM days d
  ORDER BY d.d;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_forecast_volume(int) TO authenticated;

-- ============================================================
-- 6. admin_dashboard_summary
-- MRR is a catalog-based estimate from prophiq_prices, NOT booked revenue.
-- Tile is labeled "Est. MRR" on the dashboard with a footnote.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT jsonb_build_object(
    'signups_today', (
      SELECT count(*) FROM auth.users
      WHERE created_at >= date_trunc('day', now())
        AND email IS NOT NULL
    ),
    'signups_7d', (
      SELECT count(*) FROM auth.users
      WHERE created_at >= now() - interval '7 days'
        AND email IS NOT NULL
    ),
    'active_subscriptions', (
      SELECT count(*) FROM public.subscriptions
      WHERE status IN ('active', 'trialing')
    ),
    'trialing', (
      SELECT count(*) FROM public.subscriptions
      WHERE status = 'trialing'
    ),
    'questions_today', (
      SELECT count(*) FROM public.events
      WHERE submitted_by_user_id IS NOT NULL
        AND submitted_at >= date_trunc('day', now())
    ),
    'mrr_minor_units', (
      SELECT COALESCE(sum(
        CASE WHEN pp.cadence = 'annual'
             THEN pp.amount_minor_units / 12
             ELSE pp.amount_minor_units
        END
      ), 0)
      FROM public.subscriptions s
      JOIN public.prophiq_prices pp ON pp.stripe_price_id = s.stripe_price_id
      WHERE s.status = 'active'
    ),
    'mrr_currency', (
      SELECT currency FROM public.prophiq_prices
      WHERE is_active = true
      LIMIT 1
    ),
    'health', (
      SELECT jsonb_build_object(
        'down',     count(*) FILTER (WHERE current_status = 'down'),
        'degraded', count(*) FILTER (WHERE current_status = 'degraded'),
        'ok',       count(*) FILTER (WHERE current_status = 'ok')
      )
      FROM public.admin_health_overview(24)
    ),
    'unresolved_critical', (
      SELECT count(*) FROM public.admin_notifications
      WHERE severity = 'critical' AND resolved_at IS NULL
    )
  ) INTO v;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_dashboard_summary() TO authenticated;
