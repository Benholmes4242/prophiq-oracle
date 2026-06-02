-- Fix ambiguous column reference in cron-driven prediction generation.
-- Original bug: the function's TABLE return columns (event_id, mode) clashed
-- with column references in the inner SELECTs, causing the cron job to fail.
-- Fix: the `#variable_conflict use_column` directive tells plpgsql to
-- resolve ambiguous identifiers to columns rather than to the function's
-- output variables.
--
-- Applied to remote via Supabase SQL editor on 2026-06-02; this file is the
-- canonical source-of-truth record for any future env restore.

CREATE OR REPLACE FUNCTION public.cron_generate_pending_predictions(p_limit integer DEFAULT 50)
 RETURNS TABLE(event_id uuid, mode text, request_id bigint)
 LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
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
$function$;
