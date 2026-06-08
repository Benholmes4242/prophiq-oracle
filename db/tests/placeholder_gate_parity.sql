-- =========================================================================
-- Placeholder-gate SQL parity check.
--
-- Feeds the conformance fixture labels through
-- public.is_placeholder_outcome_label and returns ONLY the rows where SQL
-- disagrees with the expected DISPLAY verdict. Empty result set = pass.
--
-- Keep the VALUES list in sync with
--   supabase/functions/_shared/__tests__/placeholderConformance.fixture.ts
-- (the `displayPlaceholder` column of each row). The edge + frontend gates
-- have their own conformance test runner; this file is the third leg.
--
-- SQL FOR BEN TO RUN after any change to the placeholder rule.
-- =========================================================================

WITH fixture(label, expected) AS (
  VALUES
    -- buckets / placeholders (display = true)
    ('Another PGA Tour player'::text, true),
    ('various drivers', true),
    ('elite players', true),
    ('Any other player', true),
    ('Any other runner', true),
    ('The field', true),
    ('rest of the field', true),
    ('multiple players', true),
    ('Player A wins', true),
    ('Horse 2 wins', true),
    ('Team A wins', true),
    ('Team B', true),
    ('Side 1', true),
    ('Pair A', true),
    -- real names (display = false)
    ('Sam Burns', false),
    ('Ryan Fox', false),
    ('Scottie Scheffler', false),
    ('Max Verstappen', false),
    ('Springfield', false),
    ('Tommy Fleetwood', false),
    ('Manchester United', false),
    ('Team Penske', false),
    ('Team Sky', false),
    ('Arsenal', false),
    ('Red Bull Racing', false),
    ('J.T. Poston', false),
    ('Liverpool win', false),
    ('Draw', false),
    ('Yes', false),
    ('No', false),
    ('Trump', false),
    -- persistence-only rejects (display = false; broad edge gate trips)
    ('Player with lowest round', false),
    ('Tied for first', false),
    ('No complete round', false),
    ('Option A', false),
    ('Outcome 2', false),
    ('Winner', false),
    ('TBD', false)
)
SELECT
  label,
  expected,
  public.is_placeholder_outcome_label(label) AS got
FROM fixture
WHERE public.is_placeholder_outcome_label(label) IS DISTINCT FROM expected;
