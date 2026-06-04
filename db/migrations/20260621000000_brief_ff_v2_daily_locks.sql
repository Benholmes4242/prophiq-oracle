-- Brief FF v2 / Phase B — Daily-lock infrastructure.
--
-- 1. homepage_picks_daily  : 6 picks frozen per day at 06:00 UTC
-- 2. featured_lead_daily   : 1 per domain frozen per day at 06:00 UTC
-- 3. get_featured_forecasts: live selector across event families
-- 4. refresh_homepage_picks_daily: SECURITY DEFINER writer, populates both
-- 5. get_today_homepage_picks / get_today_domain_lead: reader RPCs
-- 6. pg_cron schedule at 06:00 UTC
-- 7. 30-day garbage collection inside the refresh

-- ============================================================
-- 1. homepage_picks_daily
-- ============================================================
CREATE TABLE IF NOT EXISTS public.homepage_picks_daily (
  featured_date  date        NOT NULL,
  position       int         NOT NULL,
  event_id       uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  prediction_id  uuid        NOT NULL REFERENCES public.predictions(id) ON DELETE CASCADE,
  locked_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (featured_date, position)
);

CREATE INDEX IF NOT EXISTS idx_homepage_picks_daily_date
  ON public.homepage_picks_daily(featured_date DESC);

GRANT SELECT ON public.homepage_picks_daily TO anon, authenticated;
GRANT ALL    ON public.homepage_picks_daily TO service_role;

ALTER TABLE public.homepage_picks_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "homepage_picks_daily_public_read"
  ON public.homepage_picks_daily FOR SELECT USING (true);

COMMENT ON TABLE public.homepage_picks_daily IS
  'Frozen daily set of 6 homepage picks. Written by refresh_homepage_picks_daily() at 06:00 UTC.';

-- ============================================================
-- 2. featured_lead_daily
-- ============================================================
CREATE TABLE IF NOT EXISTS public.featured_lead_daily (
  featured_date  date        NOT NULL,
  domain         text        NOT NULL,
  event_id       uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  prediction_id  uuid        NOT NULL REFERENCES public.predictions(id) ON DELETE CASCADE,
  locked_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (featured_date, domain)
);

CREATE INDEX IF NOT EXISTS idx_featured_lead_daily_date
  ON public.featured_lead_daily(featured_date DESC);

GRANT SELECT ON public.featured_lead_daily TO anon, authenticated;
GRANT ALL    ON public.featured_lead_daily TO service_role;

ALTER TABLE public.featured_lead_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "featured_lead_daily_public_read"
  ON public.featured_lead_daily FOR SELECT USING (true);

COMMENT ON TABLE public.featured_lead_daily IS
  'Frozen daily lead pick per domain. Written by refresh_homepage_picks_daily() at 06:00 UTC.';

-- ============================================================
-- 3. get_featured_forecasts
--
-- Live selector. An "event family" = COALESCE(parent_event_id, id) so a
-- parent + all its binary sub-questions collapse to one family root.
-- For each family we pick the single highest-confidence prediction
-- (by agreement_score) where model_count >= 2 (consensus floor).
-- is_dominant_lead is true for every returned row — the selector emits
-- one row per family, and that row is by construction the family's lead.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_featured_forecasts(
  p_domain text DEFAULT NULL,
  p_limit  int  DEFAULT 6
)
RETURNS TABLE (
  family_root_id   uuid,
  event_id         uuid,
  prediction_id    uuid,
  domain           text,
  slug             text,
  title            text,
  question         text,
  starts_at        timestamptz,
  parent_event_id  uuid,
  top_pick_label   text,
  top_pick_pct     numeric,
  agreement_score  numeric,
  confidence       public.confidence_tier,
  model_count      int,
  is_dominant_lead boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eligible_events AS (
    SELECT
      e.id,
      e.domain,
      e.slug,
      e.title,
      e.question,
      e.starts_at,
      e.parent_event_id,
      COALESCE(e.parent_event_id, e.id) AS family_root_id
    FROM public.events e
    WHERE e.status = 'scheduled'
      AND e.starts_at >= now()
      AND e.starts_at <= now() + interval '14 days'
      AND (p_domain IS NULL OR e.domain = p_domain)
  ),
  current_preds AS (
    SELECT DISTINCT ON (p.event_id)
      p.id                                                  AS prediction_id,
      p.event_id,
      (p.ranked_outcomes -> 0 ->> 'outcome_label')          AS top_pick_label,
      ((p.ranked_outcomes -> 0 ->> 'probability')::numeric) AS top_pick_pct,
      p.agreement_score::numeric                            AS agreement_score,
      public.score_to_confidence(p.agreement_score::numeric) AS confidence,
      (
        SELECT count(*)::int
        FROM jsonb_array_elements(p.model_results) m
        WHERE (m ->> 'error') IS NULL
      )                                                     AS model_count
    FROM public.predictions p
    WHERE p.is_current = true
      AND p.mode = 'prediction'
    ORDER BY p.event_id, p.generated_at DESC
  ),
  joined AS (
    SELECT
      ev.family_root_id,
      ev.id            AS event_id,
      cp.prediction_id,
      ev.domain,
      ev.slug,
      ev.title,
      ev.question,
      ev.starts_at,
      ev.parent_event_id,
      cp.top_pick_label,
      cp.top_pick_pct,
      cp.agreement_score,
      cp.confidence,
      cp.model_count
    FROM eligible_events ev
    JOIN current_preds cp ON cp.event_id = ev.id
    WHERE cp.model_count >= 2
  ),
  family_lead AS (
    SELECT DISTINCT ON (family_root_id) *
    FROM joined
    ORDER BY family_root_id,
             agreement_score DESC NULLS LAST,
             starts_at ASC
  )
  SELECT
    family_root_id,
    event_id,
    prediction_id,
    domain,
    slug,
    title,
    question,
    starts_at,
    parent_event_id,
    top_pick_label,
    top_pick_pct,
    agreement_score,
    confidence,
    model_count,
    true AS is_dominant_lead
  FROM family_lead
  ORDER BY agreement_score DESC NULLS LAST, starts_at ASC
  LIMIT GREATEST(p_limit, 0);
$$;

GRANT EXECUTE ON FUNCTION public.get_featured_forecasts(text, int)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_featured_forecasts IS
  'Live selector: highest-confidence forecast per event family (parent+children). Filters model_count>=2.';

-- ============================================================
-- 4. refresh_homepage_picks_daily
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_homepage_picks_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today          date := (now() AT TIME ZONE 'UTC')::date;
  v_inserted_picks int  := 0;
  v_inserted_leads int  := 0;
  v_gc_picks       int  := 0;
  v_gc_leads       int  := 0;
  v_domain         text;
  v_domains        text[] := ARRAY['sport','politics','markets','entertainment'];
BEGIN
  -- 30-day garbage collection
  DELETE FROM public.homepage_picks_daily
   WHERE featured_date < v_today - INTERVAL '30 days';
  GET DIAGNOSTICS v_gc_picks = ROW_COUNT;

  DELETE FROM public.featured_lead_daily
   WHERE featured_date < v_today - INTERVAL '30 days';
  GET DIAGNOSTICS v_gc_leads = ROW_COUNT;

  -- Refresh today's rows: clear and repopulate (idempotent intra-day re-run)
  DELETE FROM public.homepage_picks_daily WHERE featured_date = v_today;
  DELETE FROM public.featured_lead_daily  WHERE featured_date = v_today;

  -- Homepage stream (6 picks)
  INSERT INTO public.homepage_picks_daily (featured_date, position, event_id, prediction_id)
  SELECT
    v_today,
    row_number() OVER ()::int,
    f.event_id,
    f.prediction_id
  FROM public.get_featured_forecasts(NULL, 6) f;
  GET DIAGNOSTICS v_inserted_picks = ROW_COUNT;

  -- One lead per domain
  FOREACH v_domain IN ARRAY v_domains LOOP
    INSERT INTO public.featured_lead_daily (featured_date, domain, event_id, prediction_id)
    SELECT v_today, v_domain, f.event_id, f.prediction_id
    FROM public.get_featured_forecasts(v_domain, 1) f
    LIMIT 1;
    IF FOUND THEN
      v_inserted_leads := v_inserted_leads + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'featured_date',     v_today,
    'inserted_picks',    v_inserted_picks,
    'inserted_leads',    v_inserted_leads,
    'gc_picks',          v_gc_picks,
    'gc_leads',          v_gc_leads
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_homepage_picks_daily()
  TO service_role;

COMMENT ON FUNCTION public.refresh_homepage_picks_daily IS
  'Cron-driven writer. Populates homepage_picks_daily + featured_lead_daily for today and GCs >30d.';

-- ============================================================
-- 5a. get_today_homepage_picks (reader)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_today_homepage_picks()
RETURNS TABLE (
  position          int,
  event_id          uuid,
  prediction_id     uuid,
  domain            text,
  slug              text,
  title             text,
  question          text,
  starts_at         timestamptz,
  parent_event_id   uuid,
  top_pick_label    text,
  top_pick_pct      numeric,
  confidence        public.confidence_tier,
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
    hp.position,
    hp.event_id,
    hp.prediction_id,
    e.domain,
    e.slug,
    e.title,
    e.question,
    e.starts_at,
    e.parent_event_id,
    (p.ranked_outcomes -> 0 ->> 'outcome_label')           AS top_pick_label,
    ((p.ranked_outcomes -> 0 ->> 'probability')::numeric)  AS top_pick_pct,
    public.score_to_confidence(p.agreement_score::numeric) AS confidence,
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
-- 5b. get_today_domain_lead (reader)
-- ============================================================
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
  top_pick_pct      numeric,
  confidence        public.confidence_tier,
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
    (p.ranked_outcomes -> 0 ->> 'outcome_label')           AS top_pick_label,
    ((p.ranked_outcomes -> 0 ->> 'probability')::numeric)  AS top_pick_pct,
    public.score_to_confidence(p.agreement_score::numeric) AS confidence,
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
-- 6. pg_cron — 06:00 UTC daily
-- ============================================================
SELECT cron.schedule(
  'refresh-homepage-picks-daily',
  '0 6 * * *',
  $$SELECT public.refresh_homepage_picks_daily();$$
);
