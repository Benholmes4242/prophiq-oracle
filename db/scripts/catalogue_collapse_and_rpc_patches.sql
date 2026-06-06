-- ============================================================
-- SQL FOR BEN TO RUN — Forecast integrity part 2.
--
-- This file is NOT auto-applied as a migration. It is a reviewed,
-- one-shot data-hygiene script with two parts:
--
--   PART A: server-side sub-question filter — patches the public RPCs
--           that currently leak sub-question rows into the public feed
--           (get_homepage_picks, get_recent_resolved, get_notable_calls,
--           search_events). Safe, idempotent CREATE OR REPLACE.
--
--   PART B: catalogue collapse — collapses existing duplicate event rows
--           down to one survivor per (domain, canonical title key, day),
--           re-points engagement/follow tables, deletes regenerable
--           prediction rows for non-survivors, then deletes the duplicate
--           event rows. The canonical key MIRRORS the new TS-side
--           canonicaliseTitle() introduced in this batch so go-forward
--           dedup and back-fill agree.
--
-- Run PART A first (zero risk). Review PART B's preview SELECT before
-- executing the destructive blocks. PART B is wrapped in a transaction
-- with a `\set` switch — leave APPLY = 0 to preview, set to 1 to commit.
--
-- Order: Lovable shipped Fix 1 (hardened stableEventId) BEFORE this
-- script. New events upserted after deploy already collide on the new
-- canonical hash. PART B then collapses the historical inventory so
-- counts stop double-reporting.
-- ============================================================


-- ============================================================
-- PART A — RPC sub-question filter patches
-- ============================================================
-- All four RPCs gained `AND e.parent_event_id IS NULL` (or equivalent
-- where the events table is the inner). Bodies are otherwise byte-equal
-- to their latest deployed versions.

-- ---------- get_homepage_picks ----------
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
      AND e.parent_event_id IS NULL  -- Fix 3: hide sub-question children
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
    LIMIT 12
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

-- ---------- get_recent_resolved ----------
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
    (p.ranked_outcomes->0->>'outcome_label')                   AS top_pick_label,
    NULLIF(p.ranked_outcomes->0->>'probability', '')::numeric  AS top_pick_pct,
    (
      SELECT eo.label
      FROM public.event_outcomes eo
      WHERE eo.id = ((er.outcome_rankings->0->>'outcome_id')::uuid)
      LIMIT 1
    )                                                          AS actual_outcome,
    pa.top_pick_correct                                        AS correct,
    p.confidence                                               AS confidence
  FROM public.events e
  JOIN public.event_resolutions er  ON er.event_id = e.id
  JOIN public.v_predictions_public p ON p.event_id = e.id AND p.is_current = true
  LEFT JOIN public.prediction_accuracy pa
    ON pa.event_id = e.id AND pa.mode = p.mode
  WHERE e.status = 'resolved'
    AND e.parent_event_id IS NULL  -- Fix 3
    AND p.mode = 'prediction'
  ORDER BY er.resolved_at DESC NULLS LAST
  LIMIT greatest(_limit, 1);
$$;
GRANT EXECUTE ON FUNCTION public.get_recent_resolved(int) TO anon, authenticated;

-- ---------- get_notable_calls ----------
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
      AND e.parent_event_id IS NULL  -- Fix 3
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

-- ---------- search_events ----------
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
  confidence      public.confidence_tier
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
    p.confidence
  FROM public.events e
  LEFT JOIN public.v_predictions_public p
    ON p.event_id = e.id AND p.is_current = true
  LEFT JOIN public.event_resolutions er
    ON er.event_id = e.id
  WHERE e.moderation_status = 'approved'
    AND e.parent_event_id IS NULL  -- Fix 3
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


-- ============================================================
-- PART B — catalogue collapse
-- ============================================================
-- Strategy:
--   1. Materialise a canonical key for every TOP-LEVEL event (excludes
--      sub-questions; they FK to a parent and collapse with it via
--      ON DELETE CASCADE).
--   2. Group by (domain, canonical_key, day(starts_at)). Pick a survivor
--      per group: earliest created_at, breaking ties by id.
--   3. For each non-survivor:
--        - Re-point engagement (event_follows, marquee picks, search
--          analytics, anything user-facing) onto the survivor.
--        - Delete the non-survivor's predictions / outcomes / resolutions /
--          sub-question CHILD events (regenerable by cron, NOT user data).
--        - Delete the non-survivor event row.
--
-- The canonical-key SQL mirrors the TypeScript canonicaliseTitle():
--   - lowercase, normalise quotes/&, strip 4-digit years and ordinal
--     suffixes
--   - synonym collapse: us / cpi / ppi / nfp / fed / gp / f1
--   - drop punctuation, drop QUALIFIER_WORDS, drop 1-char tokens
--   - sort tokens, space-join
-- Keep this in sync with supabase/functions/_shared/domains/_util.ts.

-- Toggle: leave APPLY = 0 to preview group sizes. Set to 1 to commit.
\set APPLY 0

BEGIN;

-- Helper: PL/pgSQL implementation of canonicaliseTitle(). Created in a
-- transient schema-local function so it never lingers in production.
CREATE OR REPLACE FUNCTION pg_temp._prophiq_canonicalise_title(_title text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  t text;
  tok text;
  parts text[];
  out_parts text[] := ARRAY[]::text[];
  -- NOTE: 'game','round','leg','day' are intentionally NOT qualifiers.
  -- They sit next to series numbers ("NBA Finals Game 3") and stripping
  -- them combined with dropping 1-char tokens collapsed distinct fixtures.
  qualifiers text[] := ARRAY[
    'race','match','fixture','event','edition',
    'final','finals','semi','semifinal','semifinals',
    'quarterfinal','quarterfinals','playoff','playoffs',
    'stage','tournament','championship','championships',
    'league','cup','season',
    'the','a','an','of','for',
    'triple','crown','thoroughbred','horse','racing',
    'fc','club'
  ];
BEGIN
  IF _title IS NULL THEN RETURN ''; END IF;
  t := lower(_title);
  -- normalise quotes/&
  t := regexp_replace(t, '[\u2018\u2019\u201C\u201D]', '''', 'g');
  t := replace(t, '&', ' and ');
  -- strip 4-digit years
  t := regexp_replace(t, '\m(19|20)\d{2}\M', ' ', 'g');
  -- strip ordinal suffixes on digits
  t := regexp_replace(t, '\m(\d+)(st|nd|rd|th)\M', '\1', 'g');
  -- normalise vs/v/versus
  t := regexp_replace(t, '\m(versus|vs|v)\M', ' vs ', 'g');
  -- multi-word synonym collapse
  t := regexp_replace(t, '\mu\.?s\.?a?\.?\M', ' us ', 'g');
  t := regexp_replace(t, '\munited states\M', ' us ', 'g');
  t := regexp_replace(t, '\muk\M', ' uk ', 'g');
  t := regexp_replace(t, '\munited kingdom\M', ' uk ', 'g');
  t := regexp_replace(t, '\mconsumer price index\M', ' cpi ', 'g');
  t := regexp_replace(t, '\mproducer price index\M', ' ppi ', 'g');
  t := regexp_replace(t, '\mnon-?farm payrolls?\M', ' nfp ', 'g');
  t := regexp_replace(t, '\mnonfarm payrolls?\M', ' nfp ', 'g');
  t := regexp_replace(t, '\mfederal reserve\M', ' fed ', 'g');
  t := regexp_replace(t, '\mfomc\M', ' fed ', 'g');
  t := regexp_replace(t, '\mgrand prix\M', ' gp ', 'g');
  t := regexp_replace(t, '\mformula\s*1\M', ' f1 ', 'g');
  t := regexp_replace(t, '\mformula one\M', ' f1 ', 'g');
  -- strip non-alnum punctuation, collapse whitespace
  t := regexp_replace(t, '[^[:alnum:][:space:]]', ' ', 'g');
  t := regexp_replace(t, '\s+', ' ', 'g');
  t := btrim(t);
  -- tokenise; keep numeric single-char tokens (series numbers); drop
  -- non-numeric 1-char tokens and qualifiers; dedupe.
  parts := string_to_array(t, ' ');
  SELECT array_agg(DISTINCT x ORDER BY x)
    INTO out_parts
    FROM unnest(parts) AS x
   WHERE (length(x) >= 2 OR x ~ '^[0-9]+$')
     AND NOT (x = ANY(qualifiers));
  RETURN COALESCE(array_to_string(out_parts, ' '), '');
END;
$fn$;

-- Materialise grouping into a temp table so we can preview + reuse.
CREATE TEMP TABLE _prophiq_dup_groups ON COMMIT DROP AS
WITH base AS (
  SELECT
    e.id,
    e.domain,
    e.title,
    e.starts_at,
    e.created_at,
    pg_temp._prophiq_canonicalise_title(e.title)        AS canon_key,
    (e.starts_at AT TIME ZONE 'UTC')::date              AS day_key
  FROM public.events e
  WHERE e.parent_event_id IS NULL
    AND e.source = 'discovered'           -- never touch user-submitted events
    AND COALESCE(e.is_marquee, false) = false  -- never touch curated marquee picks
),
grouped AS (
  SELECT
    domain, canon_key, day_key,
    array_agg(id ORDER BY created_at ASC, id ASC) AS ids,
    count(*)                                       AS n
  FROM base
  WHERE canon_key <> ''
  GROUP BY domain, canon_key, day_key
)
SELECT
  domain,
  canon_key,
  day_key,
  ids[1]               AS survivor_id,
  ids[2:array_length(ids,1)] AS duplicate_ids,
  n
FROM grouped
WHERE n > 1;

-- Preview the damage. Always safe to run.
SELECT
  domain,
  count(*)                AS duplicate_groups,
  sum(n - 1)::int         AS rows_to_delete,
  sum(n)::int             AS rows_in_those_groups
FROM _prophiq_dup_groups
GROUP BY domain
ORDER BY rows_to_delete DESC NULLS LAST;

SELECT 'Per-group preview (first 50)' AS section;
SELECT domain, day_key, n, survivor_id, duplicate_ids,
       (SELECT title FROM public.events WHERE id = survivor_id) AS survivor_title
FROM _prophiq_dup_groups
ORDER BY n DESC, domain
LIMIT 50;

-- Destructive section: only runs when APPLY = 1.
DO $$
DECLARE
  apply_flag int := :APPLY;
  dup_ids uuid[];
BEGIN
  IF apply_flag <> 1 THEN
    RAISE NOTICE 'APPLY=0 — preview only. No rows changed. Set "\\set APPLY 1" and rerun to commit.';
    RETURN;
  END IF;

  -- Aggregate all duplicate ids into one array for set-based operations.
  SELECT COALESCE(array_agg(d), ARRAY[]::uuid[])
    INTO dup_ids
    FROM _prophiq_dup_groups, unnest(duplicate_ids) AS d;

  IF array_length(dup_ids, 1) IS NULL THEN
    RAISE NOTICE 'No duplicates to collapse.';
    RETURN;
  END IF;

  RAISE NOTICE 'Collapsing % duplicate event rows...', array_length(dup_ids, 1);

  -- 1. Re-point engagement / user-facing FKs to survivors.
  --    Adjust this list to the actual tables that FK to events(id) in
  --    this database. If a table doesn't exist, the UPDATE is a no-op
  --    via the IF EXISTS guard.

  -- event_follows (user follows)
  IF to_regclass('public.event_follows') IS NOT NULL THEN
    UPDATE public.event_follows ef
       SET event_id = g.survivor_id
      FROM _prophiq_dup_groups g
     WHERE ef.event_id = ANY(g.duplicate_ids);
  END IF;

  -- search_queries / search_analytics (matched_event_id)
  IF to_regclass('public.search_queries') IS NOT NULL THEN
    UPDATE public.search_queries sq
       SET matched_event_id = g.survivor_id
      FROM _prophiq_dup_groups g
     WHERE sq.matched_event_id = ANY(g.duplicate_ids);
  END IF;

  -- 2. Delete regenerable artefacts on non-survivors. Children CASCADE
  --    via the FK on events.parent_event_id ON DELETE CASCADE, so
  --    sub-question rows attached to duplicates disappear with their
  --    parent in step 3. Same for event_outcomes / predictions /
  --    event_resolutions / prediction_accuracy which already CASCADE
  --    from events. If any of those FKs are RESTRICT instead of
  --    CASCADE in production, add explicit DELETE FROM ... here.

  -- 3. Delete the duplicate event rows themselves.
  DELETE FROM public.events WHERE id = ANY(dup_ids);

  RAISE NOTICE 'Collapse complete.';
END $$;

-- Post-collapse verification.
SELECT 'After-state: distinct canonical groups per domain' AS section;
SELECT domain, count(*) AS distinct_groups
FROM (
  SELECT e.domain, pg_temp._prophiq_canonicalise_title(e.title) AS canon_key,
         (e.starts_at AT TIME ZONE 'UTC')::date AS day_key
  FROM public.events e
  WHERE e.parent_event_id IS NULL
) x
GROUP BY domain
ORDER BY domain;

-- Leave the transaction open for review. Caller commits or rolls back.
-- (Set APPLY=1 and run "COMMIT;" at the psql prompt to persist.)
