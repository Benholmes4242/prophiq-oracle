-- ============================================================
-- Phase 5: Cron jobs for prophiq
--
-- Schedules:
--   discover-events       every 4 hours
--   generate-prediction   every hour, up to 50 (event, mode) pairs per run
--   score-prediction      every hour, up to 100 (event, mode) pairs per run
--
-- For events with mode = 'both', BOTH the 'prediction' and 'odds' variants are
-- generated and scored.
--
-- All jobs dispatch via net.http_post (pg_net) against the deployed edge
-- functions — they do NOT bypass them. The Authorization bearer is the
-- service-role key, read from a database setting populated once by the
-- operator (see "Operator setup" below).
--
-- Operator setup (run ONCE in the Supabase SQL editor as a superuser, AFTER
-- pasting the real values):
--
--   ALTER DATABASE postgres SET app.prophiq.supabase_url      = 'https://rkktqrqsmoumnklvsahg.supabase.co';
--   ALTER DATABASE postgres SET app.prophiq.service_role_key  = '<paste service role key>';
--   -- Reconnect (close + reopen SQL editor tab) so the new GUCs are visible.
--
-- To disable a single job:
--   UPDATE cron.job SET active = false WHERE jobname = '<jobname>';
-- To re-enable:
--   UPDATE cron.job SET active = true  WHERE jobname = '<jobname>';
-- To remove entirely:
--   SELECT cron.unschedule('<jobname>');
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ------------------------------------------------------------
-- Helper: read configured URL + key (raises a clear error if unset).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prophiq_edge_url(fn_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE base text;
BEGIN
  base := current_setting('app.prophiq.supabase_url', true);
  IF base IS NULL OR base = '' THEN
    RAISE EXCEPTION 'app.prophiq.supabase_url is not set. Run: ALTER DATABASE postgres SET app.prophiq.supabase_url = ''https://<ref>.supabase.co'';';
  END IF;
  RETURN rtrim(base, '/') || '/functions/v1/' || fn_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.prophiq_service_key()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE k text;
BEGIN
  k := current_setting('app.prophiq.service_role_key', true);
  IF k IS NULL OR k = '' THEN
    RAISE EXCEPTION 'app.prophiq.service_role_key is not set. Run: ALTER DATABASE postgres SET app.prophiq.service_role_key = ''<key>'';';
  END IF;
  RETURN k;
END;
$$;

-- ------------------------------------------------------------
-- Helper: POST to an edge function with the service-role bearer.
-- Returns the pg_net request_id (request runs async in the pg_net worker).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prophiq_call_edge(fn_name text, body jsonb)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE req_id bigint;
BEGIN
  SELECT net.http_post(
    url     := public.prophiq_edge_url(fn_name),
    body    := body,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.prophiq_service_key()
    ),
    timeout_milliseconds := 60000
  ) INTO req_id;
  RETURN req_id;
END;
$$;

-- ------------------------------------------------------------
-- discover-events: single POST every 4 hours (all registered domains).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_discover_events()
RETURNS bigint
LANGUAGE sql
AS $$
  SELECT public.prophiq_call_edge('discover-events', '{}'::jsonb);
$$;

-- ------------------------------------------------------------
-- generate-prediction: per-event, per-mode fan-out (cap 50 pairs/run).
-- Selects scheduled, approved, future-starting events that are missing a
-- fresh (<6h) current prediction in at least one required mode.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_generate_pending_predictions(p_limit int DEFAULT 50)
RETURNS TABLE(event_id uuid, mode text, request_id bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  rec record;
  rid bigint;
  cnt int := 0;
BEGIN
  FOR rec IN
    WITH required AS (
      SELECT e.id AS event_id,
             unnest(CASE WHEN e.mode = 'both'
                         THEN ARRAY['prediction','odds']
                         ELSE ARRAY[e.mode]
                    END) AS req_mode
      FROM events e
      WHERE e.status = 'scheduled'
        AND e.moderation_status = 'approved'
        AND e.starts_at > now()
    ),
    fresh AS (
      SELECT event_id, mode
      FROM predictions
      WHERE is_current = true
        AND generated_at > now() - interval '6 hours'
    )
    SELECT r.event_id, r.req_mode
    FROM required r
    LEFT JOIN fresh f ON f.event_id = r.event_id AND f.mode = r.req_mode
    JOIN events e ON e.id = r.event_id
    WHERE f.event_id IS NULL
    ORDER BY e.starts_at ASC
    LIMIT p_limit
  LOOP
    rid := public.prophiq_call_edge(
      'generate-prediction',
      jsonb_build_object('event_id', rec.event_id, 'mode', rec.req_mode)
    );
    event_id   := rec.event_id;
    mode       := rec.req_mode;
    request_id := rid;
    RETURN NEXT;
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE 'cron_generate_pending_predictions: dispatched % calls', cnt;
END;
$$;

-- ------------------------------------------------------------
-- score-prediction: per-event, per-mode fan-out (cap 100 pairs/run).
-- Selects events past resolves_at that have a current prediction in a given
-- mode but no prediction_accuracy row for that (event, mode) yet.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_score_pending_events(p_limit int DEFAULT 100)
RETURNS TABLE(event_id uuid, mode text, request_id bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  rec record;
  rid bigint;
  cnt int := 0;
BEGIN
  FOR rec IN
    SELECT p.event_id, p.mode
    FROM predictions p
    JOIN events e ON e.id = p.event_id
    LEFT JOIN prediction_accuracy a
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
      jsonb_build_object('event_id', rec.event_id, 'mode', rec.mode)
    );
    event_id   := rec.event_id;
    mode       := rec.mode;
    request_id := rid;
    RETURN NEXT;
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE 'cron_score_pending_events: dispatched % calls', cnt;
END;
$$;

-- ------------------------------------------------------------
-- Schedule. Use unschedule()/schedule() so re-running the migration is safe.
-- ------------------------------------------------------------
DO $$
DECLARE jobs text[] := ARRAY[
  'prophiq_discover_events',
  'prophiq_generate_predictions',
  'prophiq_score_predictions'
];
  j text;
BEGIN
  FOREACH j IN ARRAY jobs LOOP
    PERFORM cron.unschedule(j) FROM cron.job WHERE jobname = j;
  END LOOP;
END $$;

SELECT cron.schedule(
  'prophiq_discover_events',
  '0 */4 * * *',
  $$SELECT public.cron_discover_events();$$
);

SELECT cron.schedule(
  'prophiq_generate_predictions',
  '5 * * * *',
  $$SELECT public.cron_generate_pending_predictions(50);$$
);

SELECT cron.schedule(
  'prophiq_score_predictions',
  '15 * * * *',
  $$SELECT public.cron_score_pending_events(100);$$
);

-- Grants: cron runs as the database owner (postgres role); no extra grants
-- needed on the helper functions. Service-role app code never calls these.
REVOKE ALL ON FUNCTION public.prophiq_edge_url(text)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prophiq_service_key()               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prophiq_call_edge(text, jsonb)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_discover_events()              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_generate_pending_predictions(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_score_pending_events(int)      FROM PUBLIC;
