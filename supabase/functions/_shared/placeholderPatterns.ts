// Canonical placeholder-pattern pieces for the edge runtime.
//
// This file is the single source of truth for the SHARED pattern data used
// by two different gates:
//   - DISPLAY gate (`isDisplayPlaceholder` here) — mirrors the SQL function
//     public.is_placeholder_outcome_label exactly. Narrow scope: only the
//     generic "bucket" labels that must never headline a card.
//   - PERSISTENCE gate (`isPlaceholderLabel` in ./outcomeQuality.ts) —
//     intentionally broader. Imports the pieces from here and adds its own
//     persistence-only patterns ("Player with lowest round", "Tied for
//     first", "Option A", "No complete round", bare "Winner/TBD", etc.).
//
// The frontend cannot import from supabase/functions/_shared, so
// src/lib/placeholderOutcome.ts keeps a hand-mirrored copy. A conformance
// test in supabase/functions/_shared/__tests__/placeholderConformance.test.ts
// + db/tests/placeholder_gate_parity.sql guarantees all three implementations
// agree. Keep the SQL function, this file, and the frontend mirror in sync.

// Generic competitor buckets anywhere in the label:
//   "Another PGA Tour player", "various drivers", "elite players",
//   "some other runner", "the other team", "unspecified golfer"
export const GENERIC_BUCKET_RE =
  /\b(another|other|some|various|different|a different|the other|elite|unnamed|unspecified)\b[\s\S]*\b(player|players|runner|runners|driver|drivers|golfer|golfers|team|teams|competitor|competitors|contender|contenders|entrant|entrants)\b/i;

// Substring matches (case-insensitive) for bucket phrasings.
export const BUCKET_SUBSTRINGS: readonly string[] = [
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

// Exact (trimmed, lowercased) matches.
export const EXACT_BUCKETS: ReadonlySet<string> = new Set([
  "field",
  "the field",
  "the rest",
  "rest",
]);

// "Horse 2 wins", "Player A wins", "Horse a", "Player 1"
export const POSITIONAL_RE = /^(horse|player)\s+[a-z0-9]+(\s+wins)?$/i;

/**
 * DISPLAY gate — mirrors public.is_placeholder_outcome_label (SQL).
 * Returns true when a label is a generic placeholder/bucket that must not
 * be surfaced as a headline top pick. Narrow scope by design — use the
 * broader `isPlaceholderLabel` from ./outcomeQuality.ts at persistence.
 */
export function isDisplayPlaceholder(
  label: string | null | undefined,
): boolean {
  if (label == null) return false;
  const lower = label.trim().toLowerCase();
  if (lower.length === 0) return true;
  if (EXACT_BUCKETS.has(lower)) return true;
  for (const s of BUCKET_SUBSTRINGS) {
    if (lower.includes(s)) return true;
  }
  if (POSITIONAL_RE.test(lower)) return true;
  if (GENERIC_BUCKET_RE.test(lower)) return true;
  return false;
}
