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

/**
 * Strict no-data discipline block. Appended in ADDITION to the standard
 * discipline block when the trust layer has classified this forecast as
 * `low_data` (no structured feed, no substantive web research). The model
 * MUST produce a wide, uncertain distribution and must NOT invent entrants,
 * form, or factors.
 */
export function lowDataDisciplineBlock(): string {
  return `
LOW-DATA MODE — CRITICAL.

The trust layer has determined that NEITHER a structured feed NOR substantive live research returned real information about this event. You are forecasting without ground truth.

You MUST therefore:
- NOT invent entrants, runners, candidates, prices, polls, form, injuries, lineups, recent results, statistics, or any other specific fact. If you cannot cite it from the context blocks above, it does not exist for the purpose of this forecast.
- NOT reason from an outcome's NAME, POSITION in the list, perceived prestige, brand recognition, historical reputation, or pedigree of similarly-named entities.
- NOT treat the ABSENCE of negative information as positive evidence.
- Produce a WIDE, UNCERTAIN distribution that reflects the lack of data. Avoid false-precision confident favourites. A near-uniform distribution across the listed outcomes is the correct answer when no outcome can be meaningfully distinguished from the others on the available evidence.
- In every reason field, explicitly acknowledge the limited data (e.g. "limited public data available; ranking reflects baseline uncertainty"). Do not fabricate reasons.

A flat, honest forecast is correct in this mode. A confident, fabricated one is a failure.
`;
}
