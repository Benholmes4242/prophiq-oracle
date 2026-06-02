-- Homepage track-record RPC: returns 30-day accuracy + call count
-- Mirrors the shape used by get_receipts_stats() but scoped to a clean
-- 30-day window so the homepage stat line stays current.

CREATE OR REPLACE FUNCTION public.get_homepage_track_record()
RETURNS TABLE (
  accuracy_pct numeric,
  total_calls integer,
  window_days integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT pa.top_pick_correct
    FROM public.prediction_accuracy pa
    JOIN public.event_resolutions er ON er.event_id = pa.event_id
    WHERE pa.mode = 'prediction'
      AND er.resolved_at > now() - interval '30 days'
  )
  SELECT
    COALESCE(round(AVG(CASE WHEN top_pick_correct THEN 100.0 ELSE 0.0 END), 0), 0) AS accuracy_pct,
    count(*)::int AS total_calls,
    30 AS window_days
  FROM base;
$$;

GRANT EXECUTE ON FUNCTION public.get_homepage_track_record() TO anon, authenticated;
