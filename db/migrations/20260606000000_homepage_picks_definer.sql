-- Switch get_homepage_picks to SECURITY DEFINER so anon callers can execute it.
-- The base table public.predictions has SELECT revoked from anon/authenticated
-- (see 20260603000000_api_contract.sql). The function needs base-table access
-- for the internal model_count quality filter, so DEFINER is the correct mode.
--
-- Return shape is public-safe: confidence tier (derived) instead of raw
-- agreement_score / model_count.

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
    ORDER BY p.event_id, p.generated_at DESC
  ),
  joined AS (
    SELECT
      e.id AS event_id, e.domain, e.slug, e.title, e.question, e.starts_at,
      e.is_marquee,
      pr.top_pick_label, pr.top_pick_pct, pr.confidence, pr.agreement_score,
      pr.reasoning_excerpt
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
    LIMIT 3
  )
  SELECT event_id, domain, slug, title, question, starts_at,
         top_pick_label, top_pick_pct, confidence, reasoning_excerpt, is_marquee
  FROM (
    SELECT * FROM marquee_pick
    UNION ALL
    SELECT * FROM also_today
  ) u
  ORDER BY is_marquee DESC, agreement_score DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_homepage_picks() TO anon, authenticated;
