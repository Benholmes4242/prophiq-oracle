-- =========================================================================
-- Extend public.is_placeholder_outcome_label to catch GENERIC competitor
-- bucket labels such as "Another PGA Tour player", "various drivers",
-- "elite players", "the rest of the field" — none of which are real
-- forecasts and which must never headline a card.
--
-- Same function continues to back the homepage picks gate (and any other
-- consumer); no view recreation needed.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.is_placeholder_outcome_label(_label text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT _label IS NOT NULL AND (
       lower(_label) LIKE '%any other runner%'
    OR lower(_label) LIKE '%any other player%'
    OR lower(_label) LIKE '%other runner%'
    OR lower(_label) LIKE '%other player%'
    OR lower(_label) LIKE '%rest of the field%'
    OR lower(_label) LIKE '%rest of field%'
    OR lower(trim(_label)) IN ('field', 'the field', 'the rest', 'rest')
    OR lower(_label) LIKE '%multiple race winners%'
    OR lower(_label) LIKE '%multiple players%'
    OR lower(_label) LIKE '%multiple winners%'
    OR lower(_label) LIKE '%no clear standout%'
    OR lower(_label) LIKE '%upset by long shot%'
    OR lower(_label) LIKE '%horse named on official racecard%'
    OR lower(trim(_label)) ~ '^(horse|player) [a-z0-9]+( wins)?$'
    -- generic competitor buckets: <indefinite/quantifier> ... <generic noun>
    OR lower(_label) ~ '\m(another|other|some|various|different|a different|the other|elite|unnamed|unspecified)\M.*\m(player|players|runner|runners|driver|drivers|golfer|golfers|team|teams|competitor|competitors|contender|contenders|entrant|entrants)\M'
  );
$$;

COMMENT ON FUNCTION public.is_placeholder_outcome_label(text) IS
  'True when a top outcome label is a generic placeholder/bucket (racing, golf, or any sport). Keep in sync with src/lib/placeholderOutcome.ts and supabase/functions/_shared/outcomeQuality.ts.';

-- Fix 3: retire any currently-current prediction whose top outcome is now
-- considered a placeholder under the extended gate. Safe to re-run.
UPDATE public.predictions p
   SET is_current = false
 WHERE is_current = true
   AND public.is_placeholder_outcome_label(p.ranked_outcomes -> 0 ->> 'outcome_label');
