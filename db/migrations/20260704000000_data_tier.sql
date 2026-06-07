-- ============================================================
-- Brief: Prophiq hybrid plumbing — data-quality tiering and honest failure.
--
-- Adds two columns to `predictions` so every forecast records what real
-- data backed it:
--   - data_tier: 'feed_backed' | 'research_grounded' | 'low_data'
--   - data_sources: jsonb provenance (which feed(s) and/or research)
--
-- Then republishes:
--   - the v_predictions_public view (exposes data_tier to the public)
--   - the featured/home/notable RPCs (skip low_data forecasts)
--   - search_events (surfaces low_data, but returns data_tier so the UI
--     can render the honest label)
-- ============================================================

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS data_tier text
    CHECK (data_tier IN ('feed_backed', 'research_grounded', 'low_data'));

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS data_sources jsonb;

CREATE INDEX IF NOT EXISTS predictions_data_tier_idx
  ON public.predictions (data_tier)
  WHERE is_current = true;

-- ------------------------------------------------------------
-- v_predictions_public — expose data_tier publicly
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_predictions_public
WITH (security_invoker = on) AS
SELECT
  p.id,
  p.event_id,
  p.mode,
  p.ranked_outcomes,
  p.alternates,
  public.score_to_confidence(p.agreement_score::numeric) AS confidence,
  p.data_tier,
  p.prompt_version,
  p.is_current,
  p.generated_at
FROM public.predictions p;

GRANT SELECT ON public.v_predictions_public TO anon, authenticated;

-- ------------------------------------------------------------
-- get_homepage_picks — exclude low_data, expose data_tier
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_homepage_picks()
RETURNS TABLE (
  event_id          uuid,
  domain            text,
  slug              text,
  title             text,
  question          text,
  starts_at         timestamptz,
  top_pick_label    text,
  top_pick_pct      numeric,
  confidence        public.confidence_tier,
  data_tier         text,
  reasoning_excerpt text,
  is_marquee        boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH todays_events AS (
    SELECT
      e.id, e.domain, e.slug, e.title, e.question, e.starts_at,
      COALESCE(e.is_marquee, false) AS is_marquee
    FROM public.events e
    WHERE e.status = 'scheduled'
      AND e.parent_event_id IS NULL
      AND e.starts_at >= now()
      AND e.starts_at <= now() + interval '7 days'
  ),
  preds AS (
    SELECT DISTINCT ON (p.event_id)
      p.event_id,
      (p.ranked_outcomes -> 0 ->> 'outcome_label')          AS top_pick_label,
      ((p.ranked_outcomes -> 0 ->> 'probability')::numeric) AS top_pick_pct,
      p.agreement_score::numeric                            AS agreement_score,
      public.score_to_confidence(p.agreement_score::numeric) AS confidence,
      p.data_tier                                           AS data_tier,
      (
        SELECT count(*)::int
        FROM jsonb_array_elements(p.model_results) m
        WHERE (m ->> 'error') IS NULL
      )                                                     AS model_count,
      LEFT(
        COALESCE(p.ranked_outcomes -> 0 -> 'reasons' ->> 0, ''),
        220
      )                                                     AS reasoning_excerpt
    FROM public.predictions p
    WHERE p.is_current = true
      AND p.mode = 'prediction'
      -- Trust-layer gate: never headline a low_data forecast.
      AND (p.data_tier IS NULL OR p.data_tier IN ('feed_backed', 'research_grounded'))
    ORDER BY p.event_id, p.generated_at DESC
  ),
  joined AS (
    SELECT
      e.id AS event_id, e.domain, e.slug, e.title, e.question, e.starts_at,
      e.is_marquee,
      pr.top_pick_label, pr.top_pick_pct, pr.confidence, pr.data_tier,
      pr.agreement_score, pr.reasoning_excerpt
    FROM todays_events e
    JOIN preds pr ON pr.event_id = e.id
    WHERE pr.model_count = 3
  ),
  marquee_pick AS (
    SELECT * FROM joined WHERE is_marquee = true
    ORDER BY starts_at ASC
    LIMIT 1
  ),
  also_today AS (
    SELECT * FROM joined
    WHERE event_id NOT IN (SELECT event_id FROM marquee_pick)
    ORDER BY agreement_score DESC NULLS LAST, starts_at ASC
    LIMIT 12
  )
  SELECT event_id, domain, slug, title, question, starts_at,
         top_pick_label, top_pick_pct, confidence, data_tier,
         reasoning_excerpt, is_marquee
  FROM (
    SELECT * FROM marquee_pick
    UNION ALL
    SELECT * FROM also_today
  ) u
  ORDER BY is_marquee DESC, agreement_score DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION public.get_homepage_picks() TO anon, authenticated;

-- ------------------------------------------------------------
-- get_recent_resolved — exclude low_data
-- ------------------------------------------------------------
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
  confidence        public.confidence_tier,
  data_tier         text
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
    (p.ranked_outcomes->0->>'outcome_label')                   AS top_pick_label,
    NULLIF(p.ranked_outcomes->0->>'probability', '')::numeric  AS top_pick_pct,
    (
      SELECT eo.label
      FROM public.event_outcomes eo
      WHERE eo.id = ((er.outcome_rankings->0->>'outcome_id')::uuid)
      LIMIT 1
    )                                                          AS actual_outcome,
    pa.top_pick_correct                                        AS correct,
    p.confidence                                               AS confidence,
    p.data_tier                                                AS data_tier
  FROM public.events e
  JOIN public.event_resolutions er  ON er.event_id = e.id
  JOIN public.v_predictions_public p ON p.event_id = e.id AND p.is_current = true
  LEFT JOIN public.prediction_accuracy pa
    ON pa.event_id = e.id AND pa.mode = p.mode
  WHERE e.status = 'resolved'
    AND e.parent_event_id IS NULL
    AND p.mode = 'prediction'
    AND (p.data_tier IS NULL OR p.data_tier IN ('feed_backed', 'research_grounded'))
  ORDER BY er.resolved_at DESC NULLS LAST
  LIMIT greatest(_limit, 1);
$$;
GRANT EXECUTE ON FUNCTION public.get_recent_resolved(int) TO anon, authenticated;

-- ------------------------------------------------------------
-- get_notable_calls — exclude low_data
-- ------------------------------------------------------------
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
      AND e.parent_event_id IS NULL
      AND p.mode = 'prediction'
      AND (p.data_tier IS NULL OR p.data_tier IN ('feed_backed', 'research_grounded'))
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

-- ------------------------------------------------------------
-- search_events — DO NOT filter low_data (user explicitly searched),
-- but expose data_tier so the UI can render the honest label.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_events(
  _q text,
  _limit int DEFAULT 30
)
RETURNS TABLE (
  event_id        uuid,
  domain          text,
  slug            text,
  title           text,
  status          text,
  starts_at       timestamptz,
  resolved_at     timestamptz,
  top_pick_label  text,
  top_pick_pct    numeric,
  confidence      public.confidence_tier,
  data_tier       text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    e.id, e.domain, e.slug, e.title, e.status, e.starts_at,
    er.resolved_at,
    (p.ranked_outcomes->0->>'outcome_label')          AS top_pick_label,
    ((p.ranked_outcomes->0->>'probability')::numeric) AS top_pick_pct,
    p.confidence,
    p.data_tier
  FROM public.events e
  LEFT JOIN public.v_predictions_public p
    ON p.event_id = e.id AND p.is_current = true
  LEFT JOIN public.event_resolutions er
    ON er.event_id = e.id
  WHERE e.moderation_status = 'approved'
    AND e.parent_event_id IS NULL
    AND COALESCE(_q, '') <> ''
    AND (
      e.title_search @@ plainto_tsquery('english', _q)
      OR (p.ranked_outcomes->0->>'outcome_label') ILIKE '%' || _q || '%'
    )
  ORDER BY
    ts_rank(e.title_search, plainto_tsquery('english', _q)) DESC,
    e.starts_at DESC
  LIMIT greatest(_limit, 1);
$$;
