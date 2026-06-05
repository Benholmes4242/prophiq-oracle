-- Brief II Phase E.1 - rewrite the cron wrappers with two additions:
--   (1) is_cron_paused(<name>) early-return guard at the top
--   (2) jsonb_build_object('source','cron', ...) merged into each
--       prophiq_call_edge body so edge functions self-report only on
--       cron-sourced runs.
-- Schedules unchanged. Existing bodies preserved verbatim except for the
-- two additions. The async reality is unchanged: prophiq_call_edge is still
-- fire-and-forget via pg_net.
--
-- generate/score: per the E.1 plan, these fan-out wrappers themselves log
-- ONE summary row to cron_run_metrics (dispatched count, was_priority
-- breakdown) since they know the fan-out cardinality. The downstream edge
-- function does NOT self-report when source='cron' (avoids 50+ rows per
-- tick). discover/health/digest are single-call-per-tick and self-report
-- from inside the edge function.
--
-- Pure-SQL refresh jobs (calibration buckets, calibration curves, homepage
-- picks daily) get new wrapper functions that pause-guard, time, and log.
-- Their cron schedules are updated to call the wrappers.

-- ============================================================
-- 1. cron_discover_events  (single edge call)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cron_discover_events()
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE v_id bigint;
BEGIN
  IF public.is_cron_paused('prophiq_discover_events') THEN
    PERFORM public.log_cron_run(
      'prophiq_discover_events', 'skipped', 0, 0,
      jsonb_build_object('reason', 'paused'), NULL
    );
    RETURN NULL;
  END IF;
  v_id := public.prophiq_call_edge(
    'discover-events',
    jsonb_build_object('source', 'cron')
  );
  RETURN v_id;
END;
$$;

-- ============================================================
-- 2. cron_generate_pending_predictions
-- Preserves the HH-tightened body verbatim + adds pause guard +
-- merges source:'cron' into each per-event body + logs one summary row.
-- ============================================================
DROP FUNCTION IF EXISTS public.cron_generate_pending_predictions(integer);

CREATE OR REPLACE FUNCTION public.cron_generate_pending_predictions(p_limit integer DEFAULT 50)
RETURNS TABLE(event_id uuid, mode text, request_id bigint, was_priority boolean)
LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
DECLARE
  rec record;
  rid bigint;
  cnt int := 0;
  priority_cnt int := 0;
  started_at timestamptz := clock_timestamp();
BEGIN
  IF public.is_cron_paused('prophiq_generate_predictions') THEN
    PERFORM public.log_cron_run(
      'prophiq_generate_predictions', 'skipped', 0, 0,
      jsonb_build_object('reason', 'paused'), NULL
    );
    RETURN;
  END IF;

  FOR rec IN
    WITH featured_today AS (
      SELECT event_id FROM public.homepage_picks_daily WHERE featured_date = current_date
      UNION
      SELECT event_id FROM public.featured_lead_daily  WHERE featured_date = current_date
    ),
    must_predict AS (
      SELECT event_id, 1 AS priority FROM featured_today
      UNION
      SELECT e.parent_event_id AS event_id, 1 AS priority
      FROM public.events e
      WHERE e.id IN (SELECT event_id FROM featured_today)
        AND e.parent_event_id IS NOT NULL
      UNION
      SELECT id AS event_id, 2 AS priority
      FROM public.events
      WHERE parent_event_id IN (SELECT event_id FROM featured_today)
      UNION
      SELECT id AS event_id, 3 AS priority FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY domain ORDER BY starts_at ASC) AS rn
        FROM public.events
        WHERE status = 'scheduled'
          AND moderation_status = 'approved'
          AND starts_at > now()
          AND starts_at < now() + INTERVAL '30 days'
          AND parent_event_id IS NULL
      ) ranked WHERE rn <= 20
      UNION
      SELECT id AS event_id, 1 AS priority
      FROM public.events
      WHERE source = 'user_submitted'
        AND status = 'scheduled'
        AND moderation_status = 'approved'
        AND starts_at > now()
    ),
    required AS (
      SELECT
        mp.event_id,
        unnest(CASE WHEN e.mode = 'both'
                    THEN ARRAY['prediction','odds']
                    ELSE ARRAY[e.mode]
               END) AS req_mode,
        MIN(mp.priority) AS priority
      FROM must_predict mp
      JOIN public.events e ON e.id = mp.event_id
      WHERE e.status = 'scheduled'
        AND e.moderation_status = 'approved'
        AND e.starts_at > now()
      GROUP BY mp.event_id, e.mode
    ),
    fresh AS (
      SELECT event_id, mode
      FROM public.predictions
      WHERE is_current = true
        AND generated_at > now() - (public.cache_ttl_hours() * INTERVAL '1 hour')
    )
    SELECT r.event_id, r.req_mode, r.priority, e.starts_at
    FROM required r
    LEFT JOIN fresh f ON f.event_id = r.event_id AND f.mode = r.req_mode
    JOIN public.events e ON e.id = r.event_id
    WHERE f.event_id IS NULL
    ORDER BY r.priority ASC, e.starts_at ASC
    LIMIT p_limit
  LOOP
    rid := public.prophiq_call_edge(
      'generate-prediction',
      jsonb_build_object(
        'event_id', rec.event_id,
        'mode',     rec.req_mode,
        'source',   'cron'
      )
    );
    event_id     := rec.event_id;
    mode         := rec.req_mode;
    request_id   := rid;
    was_priority := rec.priority <= 2;
    RETURN NEXT;
    cnt := cnt + 1;
    IF rec.priority <= 2 THEN priority_cnt := priority_cnt + 1; END IF;
  END LOOP;

  -- Fan-out summary row. duration_ms is the SQL dispatch loop only - the
  -- pg_net calls are async and the edge work is not timed here.
  PERFORM public.log_cron_run(
    'prophiq_generate_predictions',
    'succeeded',
    GREATEST(0, EXTRACT(MILLISECONDS FROM clock_timestamp() - started_at)::int),
    cnt,
    jsonb_build_object(
      'dispatched',  cnt,
      'priority',    priority_cnt,
      'limit',       p_limit,
      'queue_depth', cnt
    ),
    NULL
  );

  RAISE NOTICE 'cron_generate_pending_predictions: dispatched % calls', cnt;
END;
$function$;

-- ============================================================
-- 3. cron_score_pending_events
-- ============================================================
DROP FUNCTION IF EXISTS public.cron_score_pending_events(integer);

CREATE OR REPLACE FUNCTION public.cron_score_pending_events(p_limit integer DEFAULT 100)
RETURNS TABLE(event_id uuid, mode text, request_id bigint)
LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
DECLARE
  rec record;
  rid bigint;
  cnt int := 0;
  started_at timestamptz := clock_timestamp();
BEGIN
  IF public.is_cron_paused('prophiq_score_predictions') THEN
    PERFORM public.log_cron_run(
      'prophiq_score_predictions', 'skipped', 0, 0,
      jsonb_build_object('reason', 'paused'), NULL
    );
    RETURN;
  END IF;

  FOR rec IN
    SELECT p.event_id, p.mode
    FROM public.predictions p
    JOIN public.events e ON e.id = p.event_id
    LEFT JOIN public.prediction_accuracy a
      ON a.event_id = p.event_id AND a.mode = p.mode
    WHERE p.is_current = true
      AND e.resolves_at < now()
      AND e.status <> 'cancelled'
      AND a.id IS NULL
    ORDER BY e.resolves_at ASC
    LIMIT p_limit
  LOOP
    rid := public.prophiq_call_edge(
      'score-prediction',
      jsonb_build_object(
        'event_id', rec.event_id,
        'mode',     rec.mode,
        'source',   'cron'
      )
    );
    event_id   := rec.event_id;
    mode       := rec.mode;
    request_id := rid;
    RETURN NEXT;
    cnt := cnt + 1;
  END LOOP;

  PERFORM public.log_cron_run(
    'prophiq_score_predictions',
    'succeeded',
    GREATEST(0, EXTRACT(MILLISECONDS FROM clock_timestamp() - started_at)::int),
    cnt,
    jsonb_build_object('dispatched', cnt, 'limit', p_limit),
    NULL
  );

  RAISE NOTICE 'cron_score_pending_events: dispatched % calls', cnt;
END;
$function$;

-- ============================================================
-- 4. cron_health_check  (single edge call)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cron_health_check()
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE v_id bigint;
BEGIN
  IF public.is_cron_paused('prophiq_health_check') THEN
    PERFORM public.log_cron_run(
      'prophiq_health_check', 'skipped', 0, 0,
      jsonb_build_object('reason', 'paused'), NULL
    );
    RETURN NULL;
  END IF;
  v_id := public.prophiq_call_edge(
    'health-check',
    jsonb_build_object('source', 'cron')
  );
  RETURN v_id;
END;
$$;

-- ============================================================
-- 5. cron_notification_digest  (single edge call)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cron_notification_digest()
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE v_id bigint;
BEGIN
  IF public.is_cron_paused('prophiq_notification_digest') THEN
    PERFORM public.log_cron_run(
      'prophiq_notification_digest', 'skipped', 0, 0,
      jsonb_build_object('reason', 'paused'), NULL
    );
    RETURN NULL;
  END IF;
  v_id := public.prophiq_call_edge(
    'notification-digest',
    jsonb_build_object('source', 'cron')
  );
  RETURN v_id;
END;
$$;

-- ============================================================
-- 6. Pure-SQL refresh wrappers (synchronous - we CAN time them)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cron_refresh_calibration_buckets()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  started_at timestamptz := clock_timestamp();
  v_err text;
BEGIN
  IF public.is_cron_paused('refresh-calibration-buckets') THEN
    PERFORM public.log_cron_run(
      'refresh-calibration-buckets', 'skipped', 0, 0,
      jsonb_build_object('reason','paused'), NULL
    );
    RETURN;
  END IF;
  BEGIN
    PERFORM public.refresh_calibration_buckets();
    PERFORM public.log_cron_run(
      'refresh-calibration-buckets', 'succeeded',
      GREATEST(0, EXTRACT(MILLISECONDS FROM clock_timestamp() - started_at)::int),
      NULL, '{}'::jsonb, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.log_cron_run(
      'refresh-calibration-buckets', 'failed',
      GREATEST(0, EXTRACT(MILLISECONDS FROM clock_timestamp() - started_at)::int),
      NULL, '{}'::jsonb, v_err
    );
    RAISE;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.cron_refresh_calibration_curves()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  started_at timestamptz := clock_timestamp();
  v_err text;
BEGIN
  IF public.is_cron_paused('refresh-calibration-curves') THEN
    PERFORM public.log_cron_run(
      'refresh-calibration-curves', 'skipped', 0, 0,
      jsonb_build_object('reason','paused'), NULL
    );
    RETURN;
  END IF;
  BEGIN
    PERFORM public.refresh_calibration_curves();
    PERFORM public.log_cron_run(
      'refresh-calibration-curves', 'succeeded',
      GREATEST(0, EXTRACT(MILLISECONDS FROM clock_timestamp() - started_at)::int),
      NULL, '{}'::jsonb, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.log_cron_run(
      'refresh-calibration-curves', 'failed',
      GREATEST(0, EXTRACT(MILLISECONDS FROM clock_timestamp() - started_at)::int),
      NULL, '{}'::jsonb, v_err
    );
    RAISE;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.cron_refresh_homepage_picks_daily()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  started_at timestamptz := clock_timestamp();
  v_err text;
BEGIN
  IF public.is_cron_paused('refresh-homepage-picks-daily') THEN
    PERFORM public.log_cron_run(
      'refresh-homepage-picks-daily', 'skipped', 0, 0,
      jsonb_build_object('reason','paused'), NULL
    );
    RETURN;
  END IF;
  BEGIN
    PERFORM public.refresh_homepage_picks_daily();
    PERFORM public.log_cron_run(
      'refresh-homepage-picks-daily', 'succeeded',
      GREATEST(0, EXTRACT(MILLISECONDS FROM clock_timestamp() - started_at)::int),
      NULL, '{}'::jsonb, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.log_cron_run(
      'refresh-homepage-picks-daily', 'failed',
      GREATEST(0, EXTRACT(MILLISECONDS FROM clock_timestamp() - started_at)::int),
      NULL, '{}'::jsonb, v_err
    );
    RAISE;
  END;
END;
$$;

-- ============================================================
-- 7. Re-schedule the 3 pure-SQL jobs to call the new wrappers.
-- ============================================================
DO $$
DECLARE jobs text[] := ARRAY[
  'refresh-calibration-buckets',
  'refresh-calibration-curves',
  'refresh-homepage-picks-daily'
];
  j text;
BEGIN
  FOREACH j IN ARRAY jobs LOOP
    PERFORM cron.unschedule(j) FROM cron.job WHERE jobname = j;
  END LOOP;
END $$;

SELECT cron.schedule(
  'refresh-calibration-buckets',
  '0 */6 * * *',
  $$SELECT public.cron_refresh_calibration_buckets();$$
);

SELECT cron.schedule(
  'refresh-calibration-curves',
  '0 2 * * 0',
  $$SELECT public.cron_refresh_calibration_curves();$$
);

SELECT cron.schedule(
  'refresh-homepage-picks-daily',
  '0 6 * * *',
  $$SELECT public.cron_refresh_homepage_picks_daily();$$
);
