-- =========================================================================
-- Extend the placeholder-outcome gate to cover golf bucket labels so the
-- homepage never headlines "Any other player" / "The field" when the
-- sportRadarGolf adapter bucketed the long tail.
--
-- The existing gate (see 20260705000000_placeholder_gate_and_current_dedupe)
-- only catches racing buckets. Same view + RPC continue to consume this
-- helper, so adding labels here is enough — no view recreation required.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.is_placeholder_outcome_label(_label text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT _label IS NOT NULL
     AND lower(_label) IN (
       'field',
       'the field',
       'any other runner wins',
       'any other runner',
       'any other player wins',
       'any other player',
       'multiple race winners',
       'no clear standout winner',
       'upset by long shot',
       'horse named on official racecard',
       'horse 2 wins',
       'horse 3 wins',
       'horse a wins',
       'horse b wins',
       'horse c wins',
       'player 1 wins',
       'player 2 wins',
       'player a wins',
       'player b wins',
       'player c wins'
     );
$$;

COMMENT ON FUNCTION public.is_placeholder_outcome_label(text) IS
  'True when a top outcome label is a generic placeholder (racing or golf bucket fallback). Keep in sync with src/lib/queries.ts surfacing filters.';
