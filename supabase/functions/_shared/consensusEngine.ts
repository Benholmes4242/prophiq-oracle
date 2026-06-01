// Weighted Borda count consensus across multiple model responses.
//
// Each model returns a ranked list of outcome ids (best -> worst). We score
// each outcome with (n - rank) points per model, weighted by the model's
// trust weight, then re-rank globally. Falls back to single-model output if
// only one model returned a usable ranking.

export interface ModelRanking {
  model: string;
  /** Ordered outcome ids, best first. */
  ranked_outcome_ids: string[];
  /** Optional model trust weight (default 1.0). */
  weight?: number;
  /** Optional natural-language rationale. */
  rationale?: string;
  /** Error string if this model failed. Excluded from consensus. */
  error?: string;
}

export interface ConsensusOutcome {
  outcome_id: string;
  rank: number;
  score: number;
  /** Per-model rank for this outcome (1-indexed). null if model omitted it. */
  per_model_ranks: Record<string, number | null>;
}

export interface ConsensusResult {
  method: "weighted_borda_count" | "single_model_fallback";
  ranked_outcomes: ConsensusOutcome[];
  /** 0-100. Higher = models agreed more on the top pick. */
  agreement_score: number;
  /** Aggregate Borda score of the winning outcome, normalized 0-1. */
  consensus_score: number;
  models_used: string[];
  models_failed: string[];
}

export function computeConsensus(
  rankings: ModelRanking[],
  allOutcomeIds: string[],
): ConsensusResult {
  const failed = rankings.filter((r) => r.error || r.ranked_outcome_ids.length === 0);
  const usable = rankings.filter((r) => !r.error && r.ranked_outcome_ids.length > 0);

  if (usable.length === 0) {
    throw new Error("No usable model rankings for consensus");
  }

  const n = allOutcomeIds.length;
  if (n === 0) throw new Error("No outcomes provided");

  // Accumulate weighted Borda scores.
  const scores = new Map<string, number>();
  const perModel: Map<string, Record<string, number | null>> = new Map();
  for (const id of allOutcomeIds) {
    scores.set(id, 0);
    perModel.set(id, {});
  }

  let totalWeight = 0;
  for (const r of usable) {
    const w = r.weight ?? 1.0;
    totalWeight += w;
    const seen = new Set<string>();
    r.ranked_outcome_ids.forEach((id, idx) => {
      if (!scores.has(id)) return; // ignore unknown ids
      const points = (n - idx) * w;
      scores.set(id, (scores.get(id) ?? 0) + points);
      perModel.get(id)![r.model] = idx + 1;
      seen.add(id);
    });
    // Outcomes the model didn't rank get null for transparency.
    for (const id of allOutcomeIds) {
      if (!seen.has(id) && !(r.model in perModel.get(id)!)) {
        perModel.get(id)![r.model] = null;
      }
    }
  }

  const maxPossible = n * totalWeight; // best outcome with rank 0 across all models
  const sorted = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([outcome_id, score], i) => ({
      outcome_id,
      rank: i + 1,
      score,
      per_model_ranks: perModel.get(outcome_id)!,
    }));

  const topId = sorted[0].outcome_id;
  const topPickAgreement =
    usable.filter((r) => r.ranked_outcome_ids[0] === topId).length / usable.length;

  return {
    method: usable.length === 1 ? "single_model_fallback" : "weighted_borda_count",
    ranked_outcomes: sorted,
    agreement_score: Math.round(topPickAgreement * 100),
    consensus_score: maxPossible > 0 ? sorted[0].score / maxPossible : 0,
    models_used: usable.map((r) => r.model),
    models_failed: failed.map((r) => r.model),
  };
}
