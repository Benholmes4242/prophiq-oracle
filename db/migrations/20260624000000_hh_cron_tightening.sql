-- Brief HH Phase A — tighten cron_generate_pending_predictions to predict
-- only events that are actually surfaced (featured + their families + top 20
-- per domain + user-submitted). Drops baseline prediction volume from
-- ~400/day to ~150/day with no UX regression; misses are handled by the
-- on-demand generator added in Phase B.
--
-- Also introduces public.cache_ttl_hours() as a single source of truth for
-- the cache freshness window so the SQL function and the TS constant
-- (supabase/functions/_shared/cacheTtl.ts) cannot drift again — the previous
-- function had `interval '6 hours'` hardcoded while TS said 12.
--
-- Return signature changes from (event_id, mode, request_id) to
-- (event_id, mode, request_id, was_priority). DROP first because Postgres
-- forbids changing a function's OUT columns via CREATE OR REPLACE.

-- 1. Cache TTL helper
CREATE OR REPLACE FUNCTION public.cache_ttl_hours()
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT 12;  -- matches PREDICTION_CACHE_TTL_HOURS in supabase/functions/_shared/cacheTtl.ts
$$;

COMMENT ON FUNCTION public.cache_ttl_hours() IS
  'Single source of truth for prediction cache freshness window in hours. Keep in sync with PREDICTION_CACHE_TTL_HOURS in supabase/functions/_shared/cacheTtl.ts.';

-- 2. Drop the old function so we can change its return signature
DROP FUNCTION IF EXISTS public.cron_generate_pending_predictions(integer);

-- 3. New, tightened function
CREATE OR REPLACE FUNCTION public.cron_generate_pending_predictions(p_limit integer DEFAULT 50)
RETURNS TABLE(event_id uuid, mode text, request_id bigint, was_priority boolean)
LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
DECLARE
  rec record;
  rid bigint;
  cnt int := 0;
BEGIN
  FOR rec IN
    WITH featured_today AS (
      SELECT event_id FROM public.homepage_picks_daily WHERE featured_date = current_date
      UNION
      SELECT event_id FROM public.featured_lead_daily  WHERE featured_date = current_date
    ),
    must_predict AS (
      -- Featured events themselves
      SELECT event_id, 1 AS priority FROM featured_today
      UNION
      -- Parents of featured events (in case a child was featured)
      SELECT e.parent_event_id AS event_id, 1 AS priority
      FROM public.events e
      WHERE e.id IN (SELECT event_id FROM featured_today)
        AND e.parent_event_id IS NOT NULL
      UNION
      -- Children of featured parents (so the event detail page shows the family)
      SELECT id AS event_id, 2 AS priority
      FROM public.events
      WHERE parent_event_id IN (SELECT event_id FROM featured_today)
      UNION
      -- Top 20 upcoming per domain (parents only — children fetched on detail page)
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
      -- User-submitted questions always get predicted
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
    ORDER BY r.priority ASC, e.starts_at ASC  -- priority 1 (featured) → 2 (children) → 3 (list)
    LIMIT p_limit
  LOOP
    rid := public.prophiq_call_edge(
      'generate-prediction',
      jsonb_build_object('event_id', rec.event_id, 'mode', rec.req_mode)
    );
    event_id     := rec.event_id;
    mode         := rec.req_mode;
    request_id   := rid;
    was_priority := rec.priority <= 2;
    RETURN NEXT;
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE 'cron_generate_pending_predictions: dispatched % calls', cnt;
END;
$function$;

COMMENT ON FUNCTION public.cron_generate_pending_predictions(integer) IS
  'Brief HH: dispatches generate-prediction only for surfaced events (featured + families + top 20/domain + user-submitted). was_priority=true for featured + children.';
