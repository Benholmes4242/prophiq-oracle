// Weighted Borda count consensus across multiple model responses.
//
// Each model returns a ranked list of outcome ids (best -> worst). We score
// each outcome with (n - rank) points per model, weighted by the model's
// trust weight, then re-rank globally. Falls back to single-model output if
// only one model returned a usable ranking.

/**
 * Default trust weights for known models. The engine uses these when a
 * ModelRanking does not supply `weight`. Weights are normalized at compute
 * time so adding/removing models doesn't break the maths.
 *
 * These specific defaults are calibrated from a working production prediction
 * system (Clbhouz Tournament Intelligence). Do not change without an A/B test.
 */
export const DEFAULT_MODEL_WEIGHTS: Record<string, number> = {
  claude: 0.40,
  gpt: 0.35,
  gemini: 0.25,
};

/**
 * Resolve the weight for a model: explicit `ranking.weight` wins, otherwise
 * DEFAULT_MODEL_WEIGHTS[model], otherwise 1.0.
 */
function resolveWeight(r: ModelRanking): number {
  if (typeof r.weight === "number") return r.weight;
  return DEFAULT_MODEL_WEIGHTS[r.model] ?? 1.0;
}

export interface ModelPickDetail {
  /** 1-indexed rank from this model. */
  rank: number;
  /** 0-100 model-estimated probability for this outcome. */
  probability?: number;
  /** 0-100 how well this outcome fits the data the model saw. */
  fitScore?: number;
  /** Up to 3 short reasons, each ≤ 60 chars. */
  reasons?: string[];
}

export interface ModelUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface ModelRanking {
  model: string;
  /** Ordered outcome ids, best first. */
  ranked_outcome_ids: string[];
  /** Optional model trust weight (see DEFAULT_MODEL_WEIGHTS below for defaults). */
  weight?: number;
  /** Optional per-outcome detail, keyed by outcome_id. */
  details?: Record<string, ModelPickDetail>;
  /** Optional natural-language rationale. */
  rationale?: string;
  /** Error string if this model failed. Excluded from consensus. */
  error?: string;
  /** Optional token usage, captured best-effort. Never required. */
  usage?: ModelUsage;
  /** Optional wall-clock latency in ms, captured best-effort. */
  latency_ms?: number;
}

export interface ConsensusOutcome {
  outcome_id: string;
  rank: number;
  score: number;
  /** Per-model rank for this outcome (1-indexed). null if model omitted it. */
  per_model_ranks: Record<string, number | null>;
  /**
   * Average probability across models that supplied one for this outcome.
   * null if no model supplied a probability.
   */
  probability: number | null;
  /**
   * Average fitScore across models that supplied one for this outcome.
   * null if no model supplied a fitScore.
   */
  fit_score: number | null;
  /**
   * Up to 3 deduplicated reasons aggregated across models, taken from the
   * highest-ranking model that supplied reasons for this outcome.
   */
  reasons: string[];
  /**
   * Dark horse flag: outcome ranked top-3 by exactly one model and ignored
   * (not in top-5) by the others. Used by the UI to flag contrarian picks.
   */
  is_dark_horse: boolean;
}

export interface ConsensusResult {
  method: "weighted_borda_count" | "single_model_fallback";
  ranked_outcomes: ConsensusOutcome[];
  /** 0-100. Higher = models agreed more on the top pick. */
  agreement_score: number;
  /**
   * 0–1. How dominant the winning outcome was, measured as
   * winner_borda_score / max_possible_borda_score. NOT the same as
   * agreement_score — a single model picking strongly will produce a high
   * consensus_score and a low agreement_score.
   */
  consensus_score: number;
  models_used: string[];
  models_failed: string[];
}

const AGREEMENT_WINDOW = 5;

/**
 * Pairwise top-N overlap. For every unordered pair of models, count how many
 * outcomes appear in both models' top-N lists, divide by N, average over all
 * pairs. Result is 0–1, then scaled to 0–100. With a single model returns 100.
 */
function pairwiseTopNAgreement(rankings: ModelRanking[], window: number): number {
  if (rankings.length <= 1) return 1.0;
  let totalOverlapFraction = 0;
  let pairCount = 0;
  for (let i = 0; i < rankings.length; i++) {
    for (let j = i + 1; j < rankings.length; j++) {
      const a = new Set(rankings[i].ranked_outcome_ids.slice(0, window));
      const b = new Set(rankings[j].ranked_outcome_ids.slice(0, window));
      let overlap = 0;
      for (const id of a) if (b.has(id)) overlap++;
      const denom = Math.min(window, Math.max(a.size, b.size, 1));
      totalOverlapFraction += overlap / denom;
      pairCount += 1;
    }
  }
  return pairCount === 0 ? 1.0 : totalOverlapFraction / pairCount;
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
    const w = resolveWeight(r);
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

  const sorted: ConsensusOutcome[] = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([outcome_id, score], i) => {
      const per_model_ranks = perModel.get(outcome_id)!;

      // Average probability/fit across models that supplied them for this outcome.
      const probs: number[] = [];
      const fits: number[] = [];
      let bestReasonsRank = Infinity;
      let bestReasons: string[] = [];
      for (const r of usable) {
        const d = r.details?.[outcome_id];
        if (!d) continue;
        if (typeof d.probability === "number") probs.push(d.probability);
        if (typeof d.fitScore === "number") fits.push(d.fitScore);
        if (d.reasons && d.reasons.length > 0 && d.rank < bestReasonsRank) {
          bestReasonsRank = d.rank;
          bestReasons = d.reasons.slice(0, 3);
        }
      }
      const probability = probs.length > 0 ? round1(probs.reduce((a, b) => a + b, 0) / probs.length) : null;
      const fit_score = fits.length > 0 ? Math.round(fits.reduce((a, b) => a + b, 0) / fits.length) : null;

      // Dark horse: top-3 by exactly one model AND not in top-5 of any other.
      let darkHorsePicker: string | null = null;
      let multipleTopThree = false;
      for (const r of usable) {
        const idx = r.ranked_outcome_ids.indexOf(outcome_id);
        if (idx >= 0 && idx < 3) {
          if (darkHorsePicker !== null) { multipleTopThree = true; break; }
          darkHorsePicker = r.model;
        }
      }
      let isDarkHorse = false;
      if (!multipleTopThree && darkHorsePicker !== null && usable.length >= 2) {
        isDarkHorse = usable.every((r) => {
          if (r.model === darkHorsePicker) return true;
          const idx = r.ranked_outcome_ids.indexOf(outcome_id);
          return idx === -1 || idx >= 5;
        });
      }

      return {
        outcome_id,
        rank: i + 1,
        score,
        per_model_ranks,
        probability,
        fit_score,
        reasons: bestReasons,
        is_dark_horse: isDarkHorse,
      };
    });

  const agreement = pairwiseTopNAgreement(usable, AGREEMENT_WINDOW);

  return {
    method: usable.length === 1 ? "single_model_fallback" : "weighted_borda_count",
    ranked_outcomes: sorted,
    agreement_score: Math.round(agreement * 100),
    consensus_score: maxPossible > 0 ? sorted[0].score / maxPossible : 0,
    models_used: usable.map((r) => r.model),
    models_failed: failed.map((r) => r.model),
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
