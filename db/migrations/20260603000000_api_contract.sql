-- ============================================================================
-- API CONTRACT ENFORCEMENT
-- Hide internal scoring fields from the public read surface. Server-side
-- (service_role) code still reads the base `predictions` table directly;
-- only the public anon/authenticated roles are forced through the view.
-- ============================================================================

-- 1. Public confidence enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'confidence_tier') THEN
    CREATE TYPE public.confidence_tier AS ENUM ('high', 'medium', 'mixed');
  END IF;
END$$;

-- 2. agreement_score (0-100) -> confidence_tier. Single source of truth;
--    edge functions mirror this mapping in TS — keep them in sync.
CREATE OR REPLACE FUNCTION public.score_to_confidence(score numeric)
RETURNS public.confidence_tier
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN score IS NULL THEN 'mixed'::public.confidence_tier
    WHEN score >= 80   THEN 'high'::public.confidence_tier
    WHEN score >= 50   THEN 'medium'::public.confidence_tier
    ELSE                    'mixed'::public.confidence_tier
  END;
$$;

GRANT EXECUTE ON FUNCTION public.score_to_confidence(numeric) TO anon, authenticated;

-- 3. Public view — strips consensus_method, consensus_score, agreement_score,
--    model_results. Projects a derived `confidence` enum instead.
CREATE OR REPLACE VIEW public.v_predictions_public
WITH (security_invoker = on) AS
SELECT
  p.id,
  p.event_id,
  p.mode,
  p.ranked_outcomes,
  p.alternates,
  public.score_to_confidence(p.agreement_score::numeric) AS confidence,
  p.prompt_version,
  p.is_current,
  p.generated_at
FROM public.predictions p;

GRANT SELECT ON public.v_predictions_public TO anon, authenticated;

-- 4. Lock down direct base-table reads from public roles. service_role
--    bypasses RLS and keeps full access.
REVOKE SELECT ON public.predictions FROM anon, authenticated;

ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing permissive SELECT policy on predictions for
-- anon/authenticated/public roles.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'predictions'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.predictions', pol.policyname);
  END LOOP;
END$$;

-- 5. Update get_homepage_picks: drop agreement_score + model_count from
--    the return shape, add confidence enum. Internal scoring stays in the
--    CTE and is mapped to the enum at projection time.
DROP FUNCTION IF EXISTS public.get_homepage_picks();

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
SECURITY INVOKER
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
      pr.top_pick_label, pr.top_pick_pct, pr.confidence, pr.reasoning_excerpt
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
    ORDER BY confidence ASC, starts_at ASC  -- enum order: high < medium < mixed
    LIMIT 3
  )
  SELECT event_id, domain, slug, title, question, starts_at,
         top_pick_label, top_pick_pct, confidence, reasoning_excerpt, is_marquee
  FROM (
    SELECT * FROM marquee_pick
    UNION ALL
    SELECT * FROM also_today
  ) u
  ORDER BY is_marquee DESC, confidence ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_homepage_picks() TO anon, authenticated;
