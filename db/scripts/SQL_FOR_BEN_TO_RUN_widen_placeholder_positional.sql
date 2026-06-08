-- =========================================================================
-- Widen the placeholder positional regex in
-- public.is_placeholder_outcome_label to catch short throwaway team/side
-- placeholders like "Team A", "Side 1", "Pair B wins" while leaving real
-- names ("Team Penske", "Team Sky", "Red Bull Racing", "Arsenal") alone.
--
-- Keep this file in lockstep with:
--   - supabase/functions/_shared/placeholderPatterns.ts (POSITIONAL_RE)
--   - src/lib/placeholderOutcome.ts (POSITIONAL_RE)
--   - supabase/functions/_shared/__tests__/placeholderConformance.fixture.ts
--   - db/tests/placeholder_gate_parity.sql
--
-- After running this, re-run db/tests/placeholder_gate_parity.sql and
-- expect ZERO rows back.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.is_placeholder_outcome_label(label text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  lower_label text;
BEGIN
  IF label IS NULL THEN
    RETURN false;
  END IF;

  lower_label := lower(btrim(label));

  IF lower_label = '' THEN
    RETURN true;
  END IF;

  -- Exact buckets
  IF lower_label IN ('field', 'the field', 'the rest', 'rest') THEN
    RETURN true;
  END IF;

  -- Substring buckets
  IF lower_label LIKE '%any other runner%'
     OR lower_label LIKE '%any other player%'
     OR lower_label LIKE '%other runner%'
     OR lower_label LIKE '%other player%'
     OR lower_label LIKE '%rest of the field%'
     OR lower_label LIKE '%rest of field%'
     OR lower_label LIKE '%multiple race winners%'
     OR lower_label LIKE '%multiple players%'
     OR lower_label LIKE '%multiple winners%'
     OR lower_label LIKE '%no clear standout%'
     OR lower_label LIKE '%upset by long shot%'
     OR lower_label LIKE '%horse named on official racecard%'
  THEN
    RETURN true;
  END IF;

  -- Positional placeholders. Horse/player keep the broad token form
  -- ("Horse 2", "Player A wins"). Team-family tokens are tightened to a
  -- single letter or 1-2 digit number so real names like "Team Penske"
  -- or "Red Bull Racing" don't trip the gate.
  IF lower_label ~ '^((horse|player)\s+[a-z0-9]+|(team|side|pair|group|duo)\s+([a-z]|[0-9]{1,2}))(\s+wins)?$' THEN
    RETURN true;
  END IF;

  -- Generic competitor buckets
  IF lower_label ~ '\m(another|other|some|various|different|a different|the other|elite|unnamed|unspecified)\M[\s\S]*\m(player|players|runner|runners|driver|drivers|golfer|golfers|team|teams|competitor|competitors|contender|contenders|entrant|entrants)\M' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMIT;

-- Verify:
-- \i db/tests/placeholder_gate_parity.sql
