-- =========================================================================
-- Two durable fixes (per Lovable brief "prophiq-feed-surfacing-and-dupes"):
--
-- Fix 1: expose `is_placeholder_outcome` on v_predictions_public so home rails
--        can exclude forecasts whose TOP outcome is a generic placeholder
--        ("Field", "Any other runner wins", "horse 2 wins", etc.). Racing
--        Perplexity fallbacks were slipping through the `data_tier` gate as
--        `research_grounded` and surfacing as broken-looking cards.
--
-- Fix 2: guarantee at most one is_current = true prediction per
--        (event_id, mode). Two near-simultaneous generations were leaving
--        duplicate current rows because the flip-to-false + insert pair is
--        non-atomic. Dedupe first, then add a partial unique index.
--
-- SQL FOR BEN TO RUN: this whole migration.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Dedupe existing duplicate current rows (must run BEFORE creating the
--    partial unique index, or the index build fails on conflicts).
-- -------------------------------------------------------------------------
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY event_id, mode
           ORDER BY generated_at DESC, id DESC
         ) AS rn
  FROM public.predictions
  WHERE is_current = true
)
UPDATE public.predictions p
SET is_current = false
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

-- -------------------------------------------------------------------------
-- 2. Partial unique index — DB-level guarantee. Cannot use CONCURRENTLY
--    inside a migration transaction; IF NOT EXISTS keeps it idempotent.
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uniq_current_prediction
  ON public.predictions (event_id, mode)
  WHERE is_current;

-- -------------------------------------------------------------------------
-- 3. Helper: list of placeholder top-outcome labels. Case-insensitive match
--    via lower(). Centralised so the view + future callers stay in sync.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_placeholder_outcome_label(_label text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT _label IS NOT NULL
     AND lower(_label) IN (
       'field',
       'any other runner wins',
       'multiple race winners',
       'no clear standout winner',
       'upset by long shot',
       'horse named on official racecard',
       'horse 2 wins',
       'horse 3 wins',
       'horse a wins',
       'horse b wins',
       'horse c wins'
     );
$$;

COMMENT ON FUNCTION public.is_placeholder_outcome_label(text) IS
  'True when a top outcome label is a generic placeholder (racing fallback). Keep in sync with src/lib/queries.ts surfacing filters.';

-- -------------------------------------------------------------------------
-- 4. Redefine v_predictions_public to add `is_placeholder_outcome`.
--    Appending a column at the end is fine for CREATE OR REPLACE VIEW —
--    no column reorder/retype, so no DROP needed.
-- -------------------------------------------------------------------------
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
  p.generated_at,
  public.is_placeholder_outcome_label(
    p.ranked_outcomes -> 0 ->> 'outcome_label'
  ) AS is_placeholder_outcome
FROM public.predictions p;

GRANT SELECT ON public.v_predictions_public TO anon, authenticated;

-- -------------------------------------------------------------------------
-- 5. Tighten get_homepage_picks:
--    a) exclude placeholder top outcomes (all domains)
--    b) racing (sport sub_category = horse_racing) must be feed_backed to
--       be eligible — research_grounded racing has no real runners.
--    Motorsport / non-racing research_grounded continues to surface.
-- -------------------------------------------------------------------------
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
      COALESCE(e.is_marquee, false) AS is_marquee,
      lower(COALESCE(
        e.metadata->>'sub_category',
        e.metadata->>'subcategory',
        ''
      )) AS sub_category
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
      AND (p.data_tier IS NULL OR p.data_tier IN ('feed_backed', 'research_grounded'))
      -- Fix 1: never headline a placeholder-outcome forecast.
      AND NOT public.is_placeholder_outcome_label(
        p.ranked_outcomes -> 0 ->> 'outcome_label'
      )
    ORDER BY p.event_id, p.generated_at DESC
  ),
  joined AS (
    SELECT
      e.id AS event_id, e.domain, e.slug, e.title, e.question, e.starts_at,
      e.is_marquee, e.sub_category,
      pr.top_pick_label, pr.top_pick_pct, pr.confidence, pr.data_tier,
      pr.agreement_score, pr.reasoning_excerpt
    FROM todays_events e
    JOIN preds pr ON pr.event_id = e.id
    WHERE pr.model_count = 3
      -- Fix 1 (durable): racing must be feed_backed to be featured.
      AND NOT (
        e.sub_category IN ('horse_racing', 'horseracing', 'horse racing')
        AND pr.data_tier IS DISTINCT FROM 'feed_backed'
      )
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
