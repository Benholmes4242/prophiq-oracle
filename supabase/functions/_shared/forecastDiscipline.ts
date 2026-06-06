// Shared forecast-prompt discipline appended to every domain's buildPrompt.
//
// These rules address two recurring credibility failures:
//   1. Models inventing reasoning factors from an outcome's NAME, its
//      POSITION in the outcomes list, or the ABSENCE of negative data
//      ("name recognition suggests strong pedigree", "first listed often
//      indicates favourite", "no negative form data to contradict"). When the
//      model has no real research it must say so, not confabulate factors.
//   2. Probabilities that do not form a valid distribution. The consensus
//      engine now renormalises after the fact, but we also instruct the model
//      directly so the renormalisation barely has to do anything.

/**
 * Build the trailing discipline block. Pass the wall-clock "now" so the model
 * always sees the current date and disregards stale prior-year recall.
 */
export function forecastDisciplineBlock(now: Date = new Date()): string {
  return `
CURRENT DATE: ${now.toISOString()}. Disregard any information that is not confirmed for the current cycle (current season, current election, current edition). Prior-year fields, last year's lineups, and historical winners are NOT a substitute for current data — treat them as context only and never present them as current.

REASONING DISCIPLINE — DO NOT:
- Reason from an outcome's NAME, brand, or "sounds like a favourite". Names are not evidence.
- Reason from an outcome's POSITION in the list above. Order conveys no information.
- Treat the ABSENCE of negative data as positive evidence ("no negative form data" is not a reason to rank an entity highly).
- Invent specific facts (form, polls, prices) you cannot ground in the LIVE RESEARCH CONTEXT, MARKET SIGNALS, STRUCTURED DATA, or PRIOR CONTEXT blocks above.

IF THE PROVIDED CONTEXT IS INSUFFICIENT:
- It is acceptable — and required — to say so. For any outcome whose entity is not meaningfully covered by the supplied research/data, set fit_score low and write a reason like "limited public data available; ranking reflects baseline uncertainty" rather than inventing factors.
- If NONE of the named outcomes are meaningfully covered, return a flat or near-flat distribution and say so in the rationale.

PROBABILITY CONSTRAINT:
- Probabilities for the named outcomes must sum to AT MOST 1.0 across the listed entities. If you believe the true winner is likely outside the listed field, leave the remainder unallocated (do not force the named outcomes to sum to 1.0).
`;
}
