-- Receipts page RPCs: aggregate stats, recent resolved list, notable calls.
-- Adapted to the actual schema:
--   * event_resolutions.outcome_rankings  jsonb [{outcome_id, rank}]
--   * event_outcomes.id/label             (label lookup for outcome_id)
--   * predictions.ranked_outcomes         jsonb [{outcome_id, outcome_label, probability, rank, ...}]
--   * prediction_accuracy.top_pick_correct boolean (already computed)
--   * prediction_accuracy.pick_results    jsonb [{outcome_id, predicted_rank, actual_rank, delta}]
--   * events has NO resolved_at; use event_resolutions.resolved_at as the
--     authoritative "when did we score this" timestamp.

-- ============================================================
-- get_receipts_stats() — headline numbers + 30-day rolling accuracy.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_receipts_stats()
RETURNS TABLE (
  events_scored        int,
  top_pick_hit_rate    numeric,
  top_three_hit_rate   numeric,
  days_running         int,
  last_30d_accuracy    jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      pa.event_id,
      pa.top_pick_correct,
      er.resolved_at,
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements(pa.pick_results) pr
        WHERE (pr->>'actual_rank')::int = 1
          AND (pr->>'predicted_rank')::int <= 3
      ) AS top3_correct
    FROM public.prediction_accuracy pa
    JOIN public.event_resolutions er ON er.event_id = pa.event_id
    WHERE pa.mode = 'prediction'
  ),
  daily AS (
    SELECT
      resolved_at::date AS d,
      AVG(CASE WHEN top_pick_correct THEN 100.0 ELSE 0.0 END) AS acc
    FROM base
    WHERE resolved_at > now() - interval '30 days'
    GROUP BY 1
    ORDER BY 1
  )
  SELECT
    (SELECT count(*) FROM base)::int AS events_scored,
    COALESCE(
      (SELECT round(AVG(CASE WHEN top_pick_correct THEN 100.0 ELSE 0.0 END), 0) FROM base),
      0
    ) AS top_pick_hit_rate,
    COALESCE(
      (SELECT round(AVG(CASE WHEN top3_correct THEN 100.0 ELSE 0.0 END), 0) FROM base),
      0
    ) AS top_three_hit_rate,
    COALESCE(
      (SELECT extract(day FROM (now() - min(generated_at)))::int
         FROM public.predictions),
      0
    ) AS days_running,
    COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object('date', d, 'accuracy', round(acc, 0))
                ORDER BY d
              )
         FROM daily),
      '[]'::jsonb
    ) AS last_30d_accuracy;
$$;

GRANT EXECUTE ON FUNCTION public.get_receipts_stats() TO anon, authenticated;

-- ============================================================
-- get_recent_resolved(_limit) — most recent resolved events with snapshot.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_recent_resolved(_limit int DEFAULT 10)
RETURNS TABLE (
  event_id          uuid,
  domain            text,
  slug              text,
  title             text,
  resolved_at       timestamptz,
  top_pick_label    text,
  top_pick_pct      numeric,
  actual_outcome    text,
  correct           boolean,
  confidence        public.confidence_tier
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    e.id            AS event_id,
    e.domain,
    e.slug,
    e.title,
    er.resolved_at,
    (p.ranked_outcomes->0->>'outcome_label')          AS top_pick_label,
    NULLIF(p.ranked_outcomes->0->>'probability', '')::numeric AS top_pick_pct,
    (
      SELECT eo.label
      FROM public.event_outcomes eo
      WHERE eo.id = ((er.outcome_rankings->0->>'outcome_id')::uuid)
      LIMIT 1
    )                                                  AS actual_outcome,
    pa.top_pick_correct                                AS correct,
    public.score_to_confidence(
      (SELECT agreement_score::numeric
         FROM public.predictions
         WHERE id = p.id)
    )                                                  AS confidence
  FROM public.events e
  JOIN public.event_resolutions er  ON er.event_id = e.id
  JOIN public.v_predictions_public p ON p.event_id = e.id AND p.is_current = true
  LEFT JOIN public.prediction_accuracy pa
    ON pa.event_id = e.id AND pa.mode = p.mode
  WHERE e.status = 'resolved'
    AND p.mode = 'prediction'
  ORDER BY er.resolved_at DESC NULLS LAST
  LIMIT greatest(_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_recent_resolved(int) TO anon, authenticated;

-- ============================================================
-- get_notable_calls() — dramatic correct (long-odds wins) + dramatic wrong.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_notable_calls()
RETURNS TABLE (
  event_id          uuid,
  domain            text,
  slug              text,
  title             text,
  resolved_at       timestamptz,
  top_pick_label    text,
  top_pick_pct      numeric,
  actual_outcome    text,
  correct           boolean,
  drama_score       numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scored AS (
    SELECT
      e.id AS event_id, e.domain, e.slug, e.title, er.resolved_at,
      (p.ranked_outcomes->0->>'outcome_label') AS top_pick_label,
      NULLIF(p.ranked_outcomes->0->>'probability', '')::numeric AS top_pick_pct,
      (
        SELECT eo.label
        FROM public.event_outcomes eo
        WHERE eo.id = ((er.outcome_rankings->0->>'outcome_id')::uuid)
        LIMIT 1
      ) AS actual_outcome,
      pa.top_pick_correct AS correct
    FROM public.events e
    JOIN public.event_resolutions er ON er.event_id = e.id
    JOIN public.v_predictions_public p ON p.event_id = e.id AND p.is_current = true
    LEFT JOIN public.prediction_accuracy pa
      ON pa.event_id = e.id AND pa.mode = p.mode
    WHERE e.status = 'resolved'
      AND p.mode = 'prediction'
      AND er.resolved_at > now() - interval '90 days'
  ),
  scored_with_drama AS (
    SELECT *,
      CASE
        WHEN correct THEN 100 - COALESCE(top_pick_pct, 50)
        ELSE COALESCE(top_pick_pct, 50)
      END AS drama_score
    FROM scored
  )
  (SELECT * FROM scored_with_drama WHERE correct = true  ORDER BY drama_score DESC LIMIT 2)
  UNION ALL
  (SELECT * FROM scored_with_drama WHERE correct = false ORDER BY drama_score DESC LIMIT 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_notable_calls() TO anon, authenticated;
