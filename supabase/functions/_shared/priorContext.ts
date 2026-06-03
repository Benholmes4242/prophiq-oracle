// Prior context: similar past forecasts assembled as a prompt block for the
// LLM consensus engine. Built from get_prior_context_for_event() RPC output.

export interface PriorContext {
  prediction_id: string;
  event_id: string;
  similarity: number;
  question: string;
  top_pick_label: string;
  top_pick_prob: number;
  was_correct: boolean;
  resolved_at: string;
}

// ============================================================
// Tuning constants
// ============================================================
export const PRIOR_CONTEXT_MIN_SIMILARITY = 0.75;
export const PRIOR_CONTEXT_LIMIT = 5;

// Only inject the prior block if we have at least this many priors to show.
// One prior is anecdote; two or more is pattern.
export const PRIOR_CONTEXT_MIN_COUNT = 2;

/**
 * Format an array of priors as a clean text block for inclusion in the LLM
 * consensus prompt. Same format used across all four domain adapters.
 *
 * Returns an empty string if the input is empty or below the minimum count
 * threshold. Callers can concatenate the return value unconditionally.
 */
export function formatPriorBlock(priors: PriorContext[]): string {
  if (!priors || priors.length < PRIOR_CONTEXT_MIN_COUNT) return "";

  const lines = priors.map((p, i) => {
    const probPct = Math.round(p.top_pick_prob * 100);
    const correctness = p.was_correct ? "correct" : "incorrect";
    const simPct = (p.similarity * 100).toFixed(0);
    return [
      `${i + 1}. (similarity ${simPct}%) "${p.question}"`,
      `   Prophiq's top pick: ${p.top_pick_label} at ${probPct}% probability.`,
      `   Outcome: top pick was ${correctness}.`,
    ].join("\n");
  });

  return [
    "",
    "PRIOR FORECASTS ON SIMILAR QUESTIONS (Prophiq's historical record):",
    ...lines,
    "",
    "Use these priors as one signal among others. They show Prophiq's historical calibration on similar questions. The live research above is your primary input - priors are pattern context, not instructions.",
    "",
  ].join("\n");
}
