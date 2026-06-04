-- Brief FF v2 / Phase C — Event family RPC + Phase B reader follow-ups.
--
-- 1. Phase B follow-ups:
--    a. Re-add is_dominant_lead to reader RPC output (constant true; every
--       row in the daily lock is by construction the family lead).
--    b. Change top_pick_pct return type from numeric -> double precision so
--       PostgREST serializes it as a JSON number instead of a string.
-- 2. New RPC: get_event_with_children(p_slug text) returning a jsonb shape
--    { parent: {event,prediction}, children: [{event,prediction}],
--      resolved_from_child: bool } that powers the event detail page.

-- ============================================================
-- 1a. get_today_homepage_picks — re-add is_dominant_lead, numeric->float8
-- ============================================================
DROP FUNCTION IF EXISTS public.get_today_homepage_picks();

CREATE OR REPLACE FUNCTION public.get_today_homepage_picks()
RETURNS TABLE (
  slot              int,
  event_id          uuid,
  prediction_id     uuid,
  domain            text,
  slug              text,
  title             text,
  question          text,
  starts_at         timestamptz,
  parent_event_id   uuid,
  top_pick_label    text,
  top_pick_pct      double precision,
  confidence        public.confidence_tier,
  is_dominant_lead  boolean,
  reasoning_excerpt text,
  locked_at         timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH today AS (
    SELECT MAX(featured_date) AS d FROM public.homepage_picks_daily
  )
  SELECT
    hp.position AS slot,
    hp.event_id,
    hp.prediction_id,
    e.domain,
    e.slug,
    e.title,
    e.question,
    e.starts_at,
    e.parent_event_id,
    (p.ranked_outcomes -> 0 ->> 'outcome_label')                  AS top_pick_label,
    ((p.ranked_outcomes -> 0 ->> 'probability')::double precision) AS top_pick_pct,
    public.score_to_confidence(p.agreement_score::numeric)        AS confidence,
    true                                                          AS is_dominant_lead,
    LEFT(COALESCE(p.ranked_outcomes -> 0 -> 'reasons' ->> 0, ''), 220) AS reasoning_excerpt,
    hp.locked_at
  FROM public.homepage_picks_daily hp
  JOIN today t            ON hp.featured_date = t.d
  JOIN public.events e    ON e.id = hp.event_id
  JOIN public.predictions p ON p.id = hp.prediction_id
  ORDER BY hp.position ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_today_homepage_picks()
  TO anon, authenticated, service_role;

-- ============================================================
-- 1b. get_today_domain_lead — re-add is_dominant_lead, numeric->float8
-- ============================================================
DROP FUNCTION IF EXISTS public.get_today_domain_lead(text);

CREATE OR REPLACE FUNCTION public.get_today_domain_lead(p_domain text)
RETURNS TABLE (
  domain            text,
  event_id          uuid,
  prediction_id     uuid,
  slug              text,
  title             text,
  question          text,
  starts_at         timestamptz,
  parent_event_id   uuid,
  top_pick_label    text,
  top_pick_pct      double precision,
  confidence        public.confidence_tier,
  is_dominant_lead  boolean,
  reasoning_excerpt text,
  locked_at         timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH today AS (
    SELECT MAX(featured_date) AS d
    FROM public.featured_lead_daily
    WHERE domain = p_domain
  )
  SELECT
    fl.domain,
    fl.event_id,
    fl.prediction_id,
    e.slug,
    e.title,
    e.question,
    e.starts_at,
    e.parent_event_id,
    (p.ranked_outcomes -> 0 ->> 'outcome_label')                  AS top_pick_label,
    ((p.ranked_outcomes -> 0 ->> 'probability')::double precision) AS top_pick_pct,
    public.score_to_confidence(p.agreement_score::numeric)        AS confidence,
    true                                                          AS is_dominant_lead,
    LEFT(COALESCE(p.ranked_outcomes -> 0 -> 'reasons' ->> 0, ''), 220) AS reasoning_excerpt,
    fl.locked_at
  FROM public.featured_lead_daily fl
  JOIN today t            ON fl.featured_date = t.d AND fl.domain = p_domain
  JOIN public.events e    ON e.id = fl.event_id
  JOIN public.predictions p ON p.id = fl.prediction_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_today_domain_lead(text)
  TO anon, authenticated, service_role;

-- ============================================================
-- 2. get_event_with_children(p_slug text)
--
-- Resolves the slug to its parent event (if the slug belongs to a child,
-- resolves UP to the parent) and returns the full family: parent event +
-- current prediction, plus an array of children with their current
-- predictions.
--
-- Return shape:
-- {
--   "resolved_from_child": bool,    -- true if p_slug was a child slug
--   "parent": {
--     "event":      { ...EventRow },
--     "prediction": { ...PredictionPublic } | null
--   },
--   "children": [
--     { "event": {...}, "prediction": {...}|null },
--     ...
--   ]
-- }
--
-- Returns NULL if the slug does not exist.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_event_with_children(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id   uuid;
  v_parent_id  uuid;
  v_resolved   boolean := false;
  v_result     jsonb;
BEGIN
  SELECT id, parent_event_id
    INTO v_event_id, v_parent_id
  FROM public.events
  WHERE slug = p_slug
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_parent_id IS NOT NULL THEN
    v_resolved := true;
  ELSE
    v_parent_id := v_event_id;
  END IF;

  WITH parent_row AS (
    SELECT
      to_jsonb(e.*) AS event,
      (
        SELECT to_jsonb(p.*)
        FROM public.v_predictions_public p
        WHERE p.event_id = e.id
          AND p.is_current = true
          AND p.mode = (CASE WHEN e.mode = 'odds' THEN 'odds' ELSE 'prediction' END)
        ORDER BY p.generated_at DESC
        LIMIT 1
      ) AS prediction
    FROM public.events e
    WHERE e.id = v_parent_id
  ),
  child_rows AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'event', to_jsonb(c.*),
        'prediction', (
          SELECT to_jsonb(p.*)
          FROM public.v_predictions_public p
          WHERE p.event_id = c.id
            AND p.is_current = true
            AND p.mode = (CASE WHEN c.mode = 'odds' THEN 'odds' ELSE 'prediction' END)
          ORDER BY p.generated_at DESC
          LIMIT 1
        )
      )
      ORDER BY c.starts_at ASC, c.created_at ASC
    ) AS arr
    FROM public.events c
    WHERE c.parent_event_id = v_parent_id
  )

  SELECT jsonb_build_object(
    'resolved_from_child', v_resolved,
    'parent', jsonb_build_object(
      'event',      (SELECT event      FROM parent_row),
      'prediction', (SELECT prediction FROM parent_row)
    ),
    'children', COALESCE((SELECT arr FROM child_rows), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_with_children(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_event_with_children IS
  'Returns the parent event + current prediction plus all children with their predictions. Child slugs resolve up to the parent.';
