// Pure-logic smoke test for the shared modules. No network, no Deno-only APIs.
// Run with: bun supabase/functions/_shared/__tests__/smoke.test.ts
import { computeConsensus } from "../consensusEngine.ts";
import { scorePrediction } from "../scoring.ts";
import { registerDomain, getDomain, listDomains, clearDomainsForTest } from "../domains/registry.ts";

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("ok  :", msg);
  }
}

// ---- consensusEngine ----
{
  const result = computeConsensus(
    [
      { model: "gpt", ranked_outcome_ids: ["a", "b", "c"] },
      { model: "claude", ranked_outcome_ids: ["a", "c", "b"] },
      { model: "gemini", ranked_outcome_ids: ["b", "a", "c"] },
    ],
    ["a", "b", "c"],
  );
  assert(result.method === "weighted_borda_count", "consensus uses borda when multi-model");
  assert(result.ranked_outcomes[0].outcome_id === "a", "consensus picks a as winner");
  assert(result.agreement_score === 100, `pairwise top-5 overlap is total here (got ${result.agreement_score})`);
  assert(result.models_used.length === 3, "3 models used");
}

{
  const single = computeConsensus(
    [{ model: "gpt", ranked_outcome_ids: ["x", "y"] }],
    ["x", "y"],
  );
  assert(single.method === "single_model_fallback", "single model -> fallback");
  assert(single.ranked_outcomes[0].outcome_id === "x", "single model picks first");
}

// ---- consensus: default weights, agreement, reasons, dark horse ----
{
  const result = computeConsensus(
    [
      { model: "claude", ranked_outcome_ids: ["a", "b", "c", "d", "e"], details: { a: { rank: 1, probability: 60, fitScore: 80, reasons: ["form", "h2h", "venue"] } } },
      { model: "gpt", ranked_outcome_ids: ["a", "b", "d", "c", "e"], details: { a: { rank: 1, probability: 55, fitScore: 75 } } },
      { model: "gemini", ranked_outcome_ids: ["b", "a", "c", "d", "e"], details: { a: { rank: 2, probability: 50 } } },
    ],
    ["a", "b", "c", "d", "e"],
  );
  assert(result.ranked_outcomes[0].outcome_id === "a", "weighted borda still picks a");
  assert(result.agreement_score >= 80, `pairwise top-5 agreement should be high (got ${result.agreement_score})`);
  assert(result.ranked_outcomes[0].probability !== null, "probability aggregated");
  assert(Math.abs(result.ranked_outcomes[0].probability! - 55) < 1, `probability avg of (60,55,50)=55 (got ${result.ranked_outcomes[0].probability})`);
  assert(result.ranked_outcomes[0].fit_score === 78 || result.ranked_outcomes[0].fit_score === 77, `fit_score avg of (80,75) ≈ 77.5 (got ${result.ranked_outcomes[0].fit_score})`);
  assert(result.ranked_outcomes[0].reasons.length === 3, "best reasons carried through");
}

// ---- consensus: dark horse detection ----
{
  const result = computeConsensus(
    [
      { model: "claude", ranked_outcome_ids: ["z", "a", "b", "c", "d"] },
      { model: "gpt", ranked_outcome_ids: ["a", "b", "c", "d", "e"] },
      { model: "gemini", ranked_outcome_ids: ["a", "b", "c", "d", "e"] },
    ],
    ["a", "b", "c", "d", "e", "z"],
  );
  const z = result.ranked_outcomes.find((o) => o.outcome_id === "z");
  assert(z !== undefined, "z is in results");
  assert(z!.is_dark_horse === true, "z is flagged as dark horse");
  const a = result.ranked_outcomes.find((o) => o.outcome_id === "a");
  assert(a!.is_dark_horse === false, "a is NOT a dark horse (multiple models picked it)");
}

// ---- consensus: default weights actually used ----
{
  const result = computeConsensus(
    [
      { model: "claude", ranked_outcome_ids: ["q", "p"] },
      { model: "gemini", ranked_outcome_ids: ["p", "q"] },
    ],
    ["p", "q"],
  );
  assert(result.ranked_outcomes[0].outcome_id === "q", `claude weight 0.40 should outweigh gemini 0.25 (got ${result.ranked_outcomes[0].outcome_id})`);
}

// ---- scoring ----
{
  const s = scorePrediction(
    [
      { outcome_id: "a", rank: 1 },
      { outcome_id: "b", rank: 2 },
      { outcome_id: "c", rank: 3 },
    ],
    [
      { outcome_id: "a", rank: 1 },
      { outcome_id: "b", rank: 3 },
      { outcome_id: "c", rank: 2 },
    ],
  );
  assert(s.top_pick_correct, "top pick correct");
  assert(s.accuracy_grade === "excellent", "excellent grade when top pick correct");
  assert(s.picks_in_top_3 === 3, "all 3 in top 3");
}

{
  const s = scorePrediction(
    [{ outcome_id: "a", rank: 1 }],
    [{ outcome_id: "a", rank: 5 }],
  );
  assert(!s.top_pick_correct, "wrong top pick");
  assert(s.accuracy_grade === "poor", `single pick at rank 5 → poor (got ${s.accuracy_grade})`);
}

// ---- scoring: brief-spec grading thresholds ----
{
  // 3 picks all land in top 5 but top pick is wrong → 'good'
  const s = scorePrediction(
    [
      { outcome_id: "a", rank: 1 },
      { outcome_id: "b", rank: 2 },
      { outcome_id: "c", rank: 3 },
    ],
    [
      { outcome_id: "a", rank: 2 },
      { outcome_id: "b", rank: 4 },
      { outcome_id: "c", rank: 5 },
    ],
  );
  assert(!s.top_pick_correct, "top pick wrong");
  assert(s.picks_in_top_5 === 3, "3 picks in top 5");
  assert(s.accuracy_grade === "good", `should be 'good' (got ${s.accuracy_grade})`);
}

// ---- scoring: 'mixed' grade ----
{
  // 2 picks both landing in top 10 but none in top 5, top pick wrong → 'mixed'
  const s = scorePrediction(
    [
      { outcome_id: "a", rank: 1 },
      { outcome_id: "b", rank: 2 },
    ],
    [
      { outcome_id: "a", rank: 7 },
      { outcome_id: "b", rank: 9 },
    ],
  );
  assert(!s.top_pick_correct, "top pick wrong");
  assert(s.picks_in_top_5 === 0, "0 picks in top 5");
  assert(s.picks_in_top_10 === 2, "2 picks in top 10");
  assert(s.accuracy_grade === "mixed", `should be 'mixed' (got ${s.accuracy_grade})`);
}

// ---- registry ----
{
  clearDomainsForTest();
  registerDomain({
    id: "test",
    displayName: "Test",
    discover: async () => [],
    resolve: async () => null,
    buildPrompt: () => "prompt",
  });
  assert(getDomain("test").displayName === "Test", "registry get works");
  assert(listDomains().length === 1, "registry list works");
  clearDomainsForTest();
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll shared-module tests passed.");
