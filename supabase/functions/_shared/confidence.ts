// Mirrors the SQL public.score_to_confidence() mapping. If you change the
// thresholds here, change them in db/migrations/20260603000000_api_contract.sql
// at the same time.

export type ConfidenceTier = "high" | "medium" | "mixed";

export function scoreToConfidence(
  score: number | null | undefined,
): ConfidenceTier {
  if (score == null) return "mixed";
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "mixed";
}
