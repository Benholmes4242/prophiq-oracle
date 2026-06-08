/**
 * Frontend DISPLAY-gate mirror of:
 *   - SQL: public.is_placeholder_outcome_label
 *   - Edge (canonical TS): supabase/functions/_shared/placeholderPatterns.ts
 *                          (isDisplayPlaceholder + the shared pattern pieces)
 *
 * The frontend bundle cannot import from supabase/functions/_shared, so this
 * file is a HAND-MIRRORED copy of the canonical edge module above. When you
 * change a pattern here, change it in placeholderPatterns.ts AND in the SQL
 * migration too. The drift guard is the conformance test at
 *   supabase/functions/_shared/__tests__/placeholderConformance.test.ts
 * plus the SQL parity query at db/tests/placeholder_gate_parity.sql — run
 * both after any change.
 *
 * Scope: narrow. Returns true only for generic buckets / placeholders that
 * must never headline a card ("Any other player", "Another PGA Tour
 * player", "the field", "various drivers", ...). The broader persistence
 * gate lives in supabase/functions/_shared/outcomeQuality.ts and is not
 * mirrored here.
 */


const EXACT_PLACEHOLDERS = new Set([
  "field",
  "the field",
  "the rest",
  "rest",
]);

const SUBSTRING_PATTERNS = [
  "any other runner",
  "any other player",
  "other runner",
  "other player",
  "rest of the field",
  "rest of field",
  "multiple race winners",
  "multiple players",
  "multiple winners",
  "no clear standout",
  "upset by long shot",
  "horse named on official racecard",
];

// "Horse 2 wins", "Player A wins", "Horse a", "Player 1"
// Also: short throwaway team/side placeholders like "Team A", "Side 1",
// "Pair B wins". Tightened to a single letter or 1-2 digit number to
// avoid catching real names like "Team Penske" or "Red Bull Racing".
const POSITIONAL_RE =
  /^((horse|player)\s+[a-z0-9]+|(team|side|pair|group|duo)\s+([a-z]|[0-9]{1,2}))(\s+wins)?$/i;

// Generic competitor buckets: <indefinite/quantifier> ... <generic noun>
const GENERIC_BUCKET_RE =
  /\b(another|other|some|various|different|a different|the other|elite|unnamed|unspecified)\b[\s\S]*\b(player|players|runner|runners|driver|drivers|golfer|golfers|team|teams|competitor|competitors|contender|contenders|entrant|entrants)\b/i;

export function isPlaceholderOutcomeLabel(
  label: string | null | undefined,
): boolean {
  if (!label) return false;
  const lower = label.trim().toLowerCase();
  if (lower.length === 0) return true;
  if (EXACT_PLACEHOLDERS.has(lower)) return true;
  for (const s of SUBSTRING_PATTERNS) {
    if (lower.includes(s)) return true;
  }
  if (POSITIONAL_RE.test(lower)) return true;
  if (GENERIC_BUCKET_RE.test(lower)) return true;
  return false;
}
