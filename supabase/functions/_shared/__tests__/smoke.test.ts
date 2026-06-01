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
  assert(s.accuracy_grade === "mixed", `mixed when avg<=10 (got ${s.accuracy_grade})`);
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
