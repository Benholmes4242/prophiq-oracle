// Unit tests for structured data formatter + adapter weaving. No DB, no network.
// Run: deno test supabase/functions/_shared/__tests__/structuredData.test.ts

import { formatStructuredDataBlock, type StructuredData } from "../structuredData.ts";
import { sportAdapter } from "../domains/sport.ts";
import { politicsAdapter } from "../domains/politics.ts";
import { marketsAdapter } from "../domains/markets.ts";
import { entertainmentAdapter } from "../domains/entertainment.ts";
import type { DomainAdapter, DomainEvent, EventOutcome } from "../domain.ts";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`ok : ${msg}`);
  } else {
    failed++;
    console.error(`FAIL: ${msg}`);
  }
}

// === formatStructuredDataBlock tests ===
assert(formatStructuredDataBlock(null) === "", "null input returns empty string");

const emptyData: StructuredData = {
  source: "api-sports-football-v3",
  source_version: "v3",
  fetched_at: new Date().toISOString(),
  payload: {},
  summary_lines: [],
};
assert(formatStructuredDataBlock(emptyData) === "", "empty summary_lines returns empty string");

const mockData: StructuredData = {
  source: "api-sports-football-v3",
  source_version: "v3",
  fetched_at: new Date().toISOString(),
  payload: { test: true },
  summary_lines: [
    "Manchester City recent form (last 5): W 3-0 vs Newcastle; W 2-1 vs Arsenal; D 1-1 vs Liverpool; W 4-1 vs Brighton; W 2-0 vs Tottenham",
    "Liverpool recent form (last 5): W 4-0 vs Bournemouth; D 2-2 vs Aston Villa; W 3-1 vs Chelsea; W 2-1 vs Manchester United; L 1-2 vs Manchester City",
    "Head-to-head (last 5): Manchester City 2W 2D 1L Liverpool (recent scores Manchester City perspective: 2-0, 1-1, 1-2)",
  ],
};
const block = formatStructuredDataBlock(mockData);
assert(block.includes("STRUCTURED DATA"), "block contains canonical header");
assert(block.includes("api-sports-football-v3"), "block names the source");
assert(
  block.includes("Manchester City") && block.includes("Liverpool"),
  "block contains team names",
);
assert(block.includes("Head-to-head"), "block contains H2H line");
assert(
  block.includes("primary factual ground truth"),
  "block contains the framing line",
);

// === Adapter weaving across all four ===
const mockEvent: DomainEvent = {
  id: "test",
  domain: "sport",
  external_id: "x",
  slug: "test",
  title: "Premier League fixture",
  question: "Manchester City v Liverpool",
  starts_at: "2026-06-15T15:00:00Z",
  resolves_at: "2026-06-15T18:00:00Z",
  status: "scheduled",
  mode: "prediction",
  source: "discovered",
  moderation_status: "approved",
  metadata: null,
};
const mockOutcomes: EventOutcome[] = [
  {
    id: "o1",
    event_id: mockEvent.id,
    external_id: null,
    label: "Manchester City win",
    metadata: null,
  },
];

function exerciseAdapter(name: string, adapter: DomainAdapter) {
  const withData = adapter.buildPrompt(
    mockEvent,
    mockOutcomes,
    "prediction",
    undefined,
    undefined,
    undefined,
    mockData,
  );
  assert(
    withData.includes("STRUCTURED DATA"),
    `${name}: buildPrompt weaves structured block when data provided`,
  );

  const withoutData = adapter.buildPrompt(mockEvent, mockOutcomes, "prediction");
  assert(
    !withoutData.includes("STRUCTURED DATA"),
    `${name}: buildPrompt omits structured block when data absent`,
  );
}

exerciseAdapter("sport", sportAdapter);
exerciseAdapter("politics", politicsAdapter);
exerciseAdapter("markets", marketsAdapter);
exerciseAdapter("entertainment", entertainmentAdapter);

// === Stub adapters return null from gatherStructuredData ===
async function checkStub(name: string, adapter: DomainAdapter) {
  if (typeof adapter.gatherStructuredData !== "function") {
    assert(true, `${name}: gatherStructuredData not implemented (acceptable for stubs)`);
    return;
  }
  const result = await adapter.gatherStructuredData(
    // deno-lint-ignore no-explicit-any
    null as any,
    mockEvent,
    mockOutcomes,
  );
  assert(result === null, `${name}: stub gatherStructuredData returns null`);
}

await checkStub("politics", politicsAdapter);
await checkStub("markets", marketsAdapter);
await checkStub("entertainment", entertainmentAdapter);

// === Block placement order: structured data sits AFTER markets ===
const allBlocks = sportAdapter.buildPrompt(
  mockEvent,
  mockOutcomes,
  "prediction",
  {
    synthesised: "RESEARCH_SENTINEL",
    fetched_at: "x",
    sources: [],
    tokens_used: 0,
    model: "x",
    research_prompt_version: "v",
  },
  [
    {
      // deno-lint-ignore no-explicit-any
      prediction_id: "p",
      event_id: "e",
      question: "test",
      similarity: 0.9,
      top_pick_label: "x",
      top_pick_prob: 0.5,
      was_correct: true,
      resolved_at: "x",
    } as any,
  ],
  [
    {
      venue: "polymarket",
      market_id: "x",
      market_question: "x",
      market_outcome_label: "MARKET_SENTINEL",
      implied_probability: 0.5,
      volume_usd: null,
      fetched_at: "x",
      age_minutes_at_call: 0,
    },
  ],
  mockData,
);
const idxResearch = allBlocks.indexOf("RESEARCH_SENTINEL");
const idxMarket = allBlocks.indexOf("MARKET_SENTINEL");
const idxStructured = allBlocks.indexOf("STRUCTURED DATA");
assert(
  idxResearch >= 0 && idxMarket >= 0 && idxStructured >= 0,
  "all three sentinel blocks present in composite prompt",
);
assert(
  idxResearch < idxMarket && idxMarket < idxStructured,
  "block order: research < markets < structured (structured closest to ranking instruction)",
);

console.log(`\n${passed} passed, ${failed} failed`);
const deno = (globalThis as { Deno?: { exit(c: number): never } }).Deno;
if (failed > 0 && deno) deno.exit(1);
