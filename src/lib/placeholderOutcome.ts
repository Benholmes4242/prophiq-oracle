/**
 * Frontend mirror of public.is_placeholder_outcome_label (SQL) and
 * supabase/functions/_shared/outcomeQuality.ts (backend). Returns true when
 * the label is a generic bucket / placeholder ("Any other player",
 * "Another PGA Tour player", "the field", "various drivers", ...) rather
 * than a real named outcome. Such labels must never headline an event or
 * be presented as a top pick with a percentage.
 *
 * Keep these three implementations in sync.
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
const POSITIONAL_RE = /^(horse|player)\s+[a-z0-9]+(\s+wins)?$/i;

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
