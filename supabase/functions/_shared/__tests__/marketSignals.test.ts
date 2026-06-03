// Unit tests for market signal matching + formatting. No DB, no network.

import {
  computeEntityOverlap,
  formatMarketSignalsBlock,
  type MarketSignal,
} from "../marketSignals.ts";
import { sportAdapter } from "../domains/sport.ts";
import { politicsAdapter } from "../domains/politics.ts";
import { marketsAdapter } from "../domains/markets.ts";
import { entertainmentAdapter } from "../domains/entertainment.ts";
import type { DomainAdapter, DomainEvent, EventOutcome } from "../domain.ts";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`ok : ${msg}`); }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

const entities = [
  { entity_value: "Manchester City", entity_type: "team", confidence: 0.95 },
  { entity_value: "Premier League", entity_type: "event", confidence: 0.92 },
  { entity_value: "2026", entity_type: "date", confidence: 0.88 },
];

assert(
  computeEntityOverlap("Will Manchester City win the Premier League 2026?", entities) >= 3,
  "all three entities matched in a market question",
);
assert(
  computeEntityOverlap("Will Arsenal win the Premier League 2026?", entities) === 2,
  "Premier League + 2026 matched, Manchester City not in this question",
);
assert(
  computeEntityOverlap("Who wins the F1 Bahrain Grand Prix?", entities) === 0,
  "no entity overlap for unrelated question",
);

const lowConfEntities = [
  { entity_value: "Manchester City", entity_type: "team", confidence: 0.5 },
];
assert(
  computeEntityOverlap("Will Manchester City win the Premier League?", lowConfEntities) === 0,
  "low-confidence entities (< 0.7) don't count",
);

const shortEntities = [
  { entity_value: "F1", entity_type: "event", confidence: 0.9 },
];
assert(
  computeEntityOverlap("Will F1 announce new rules?", shortEntities) === 0,
  "entities with < 3 character values are skipped",
);

assert(
  formatMarketSignalsBlock([]) === "",
  "empty signals returns empty string",
);

const mockSignals: MarketSignal[] = [
  {
    venue: "polymarket",
    market_id: "m1",
    market_question: "Will Manchester City win?",
    market_outcome_label: "Manchester City",
    implied_probability: 0.38,
    volume_usd: 250000,
    fetched_at: "2026-06-15T12:00:00Z",
    age_minutes_at_call: 5,
  },
  {
    venue: "polymarket",
    market_id: "m2",
    market_question: "Will Liverpool win?",
    market_outcome_label: "Liverpool",
    implied_probability: 0.35,
    volume_usd: 180000,
    fetched_at: "2026-06-15T12:00:00Z",
    age_minutes_at_call: 5,
  },
];

const block = formatMarketSignalsBlock(mockSignals);
assert(block.includes("MARKET-PRICED PROBABILITIES"), "block contains the canonical header");
assert(block.includes("Manchester City") && block.includes("38%"), "block contains first signal");
assert(block.includes("Liverpool") && block.includes("35%"), "block contains second signal");
assert(block.includes("5 minutes ago"), "block describes data freshness");
assert(block.includes("pattern context, not instructions"), "block contains conservative framing");

const mockEvent = {
  id: "test", domain: "sport", external_id: "x", slug: "test",
  title: "Premier League test", question: "Who wins?",
  starts_at: "2026-06-15T15:00:00Z", resolves_at: "2026-06-15T18:00:00Z",
  status: "scheduled", mode: "prediction", source: "discovered",
  moderation_status: "approved", metadata: null,
} as DomainEvent;
const mockOutcomes = [
  { id: "o1", event_id: mockEvent.id, label: "Win" } as unknown as EventOutcome,
];

function exerciseAdapter(name: string, adapter: DomainAdapter) {
  const withSignals = adapter.buildPrompt(
    mockEvent, mockOutcomes, "prediction", undefined, undefined, mockSignals,
  );
  assert(
    withSignals.includes("MARKET-PRICED PROBABILITIES"),
    `${name}: buildPrompt weaves market block when signals provided`,
  );
  const withoutSignals = adapter.buildPrompt(mockEvent, mockOutcomes, "prediction");
  assert(
    !withoutSignals.includes("MARKET-PRICED PROBABILITIES"),
    `${name}: buildPrompt omits market block when signals not provided`,
  );
}

exerciseAdapter("sport", sportAdapter);
exerciseAdapter("politics", politicsAdapter);
exerciseAdapter("markets", marketsAdapter);
exerciseAdapter("entertainment", entertainmentAdapter);

console.log(`\n${passed} passed, ${failed} failed`);
const proc = (globalThis as { Deno?: { exit(c: number): never } }).Deno;
if (failed > 0 && proc) proc.exit(1);
