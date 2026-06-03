// Unit tests for deterministic signal extraction. No LLM calls.

import { extractSignalsUsed } from "../signals.ts";
import type { ModelRanking } from "../consensusEngine.ts";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`ok : ${msg}`); }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

function mkModelResult(reasons: string[]): ModelRanking {
  return {
    model: "test-model",
    ranked_outcome_ids: ["o1", "o2"],
    details: {
      o1: { rank: 1, reasons },
      o2: { rank: 2, reasons: [] },
    },
  };
}

// === SPORT ===
{
  const signals = extractSignalsUsed("sport", [
    mkModelResult([
      "Liverpool in great form (5W in last 6)",
      "H2H favours Liverpool 3-2 over the last 5 meetings",
      "Salah is injured and likely to miss out",
    ]),
  ]);
  assert(signals.includes("recent_form"),     "sport: detects 'form' in reasons");
  assert(signals.includes("head_to_head"),    "sport: detects 'H2H' in reasons");
  assert(signals.includes("injuries"),        "sport: detects 'injured' in reasons");
  assert(!signals.includes("weather"),        "sport: does NOT detect weather when absent");
}

// === POLITICS ===
{
  const signals = extractSignalsUsed("politics", [
    mkModelResult([
      "Latest YouGov poll has Labour at 42%",
      "Polymarket implied probability 67%",
    ]),
  ]);
  assert(signals.includes("polling"),           "politics: detects 'poll' in reasons");
  assert(signals.includes("prediction_market"), "politics: detects 'Polymarket' in reasons");
}

// === MARKETS ===
{
  const signals = extractSignalsUsed("markets", [
    mkModelResult([
      "ECB minutes were dovish",
      "OIS curve prices 25bp cut",
      "Sell-side consensus expects hold",
    ]),
  ]);
  assert(signals.includes("central_bank"),       "markets: detects 'ECB' in reasons");
  assert(signals.includes("market_positioning"), "markets: detects 'OIS curve' in reasons");
  assert(signals.includes("analyst_consensus"),  "markets: detects 'consensus' in reasons");
}

// === ENTERTAINMENT ===
{
  const signals = extractSignalsUsed("entertainment", [
    mkModelResult([
      "Won the DGA award last week",
      "Strong audience momentum after opening weekend",
    ]),
  ]);
  assert(signals.includes("guild_awards"),      "entertainment: detects 'DGA' in reasons");
  assert(signals.includes("audience_momentum"), "entertainment: detects 'opening weekend' in reasons");
}

// === EDGE: empty model results ===
{
  const signals = extractSignalsUsed("sport", []);
  assert(signals.length === 0, "empty model_results returns empty signals");
}

// === EDGE: errored model is skipped ===
{
  const signals = extractSignalsUsed("sport", [
    { model: "errored", ranked_outcome_ids: [], error: "rate limited" } as ModelRanking,
  ]);
  assert(signals.length === 0, "errored model contributes no signals");
}

// === EDGE: unknown domain returns empty ===
{
  const signals = extractSignalsUsed("nonexistent_domain", [
    mkModelResult(["form is great"]),
  ]);
  assert(signals.length === 0, "unknown domain returns empty signals");
}

console.log(`\n${passed} passed, ${failed} failed`);
const proc = (globalThis as { Deno?: { exit(c: number): never } }).Deno;
if (failed > 0 && proc) proc.exit(1);
