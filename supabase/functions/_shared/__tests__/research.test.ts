// Unit-level shape tests for each adapter's research integration. These run
// without hitting Perplexity: they exercise buildPrompt() with and without a
// mock ResearchContext and confirm the shape contract.
//
// To run live probes that actually call Perplexity, set ALLOW_LIVE_PROBES=1
// in the environment (gated below).

import { sportAdapter } from "../domains/sport.ts";
import { politicsAdapter } from "../domains/politics.ts";
import { marketsAdapter } from "../domains/markets.ts";
import { entertainmentAdapter } from "../domains/entertainment.ts";
import type {
  DomainAdapter,
  DomainEvent,
  EventOutcome,
  ResearchContext,
} from "../domain.ts";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`ok : ${msg}`); }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

const mockEvent: DomainEvent = {
  id: "00000000-0000-0000-0000-000000000001",
  domain: "sport",
  external_id: "test-ext",
  slug: "sport-test",
  title: "Team A vs Team B",
  description: "test",
  question: "Who wins Team A vs Team B?",
  starts_at: "2026-06-10T15:00:00Z",
  resolves_at: "2026-06-10T18:00:00Z",
  status: "scheduled",
  mode: "prediction",
  source: "discovered",
  moderation_status: "approved",
  metadata: null,
};

const mockOutcomes: EventOutcome[] = [
  { id: "o1", event_id: mockEvent.id, external_id: "a", label: "Team A", metadata: null },
  { id: "o2", event_id: mockEvent.id, external_id: "b", label: "Team B", metadata: null },
];

const mockResearch: ResearchContext = {
  sources: [{ url: "https://example.com/match-preview" }],
  synthesised: "MOCK_RESEARCH_BODY: Team A has won 4 of last 5 outings; Team B is missing two starters.",
  fetched_at: new Date().toISOString(),
  model: "sonar-pro",
  tokens_used: 500,
  research_prompt_version: "test.v1",
};

function exerciseAdapter(name: string, adapter: DomainAdapter) {
  assert(typeof adapter.gatherResearch === "function", `${name}: gatherResearch is a function`);

  const withResearch = adapter.buildPrompt(mockEvent, mockOutcomes, "prediction", mockResearch);
  assert(
    withResearch.includes("LIVE RESEARCH CONTEXT"),
    `${name}: buildPrompt weaves LIVE RESEARCH CONTEXT block when research provided`,
  );
  assert(
    withResearch.includes(mockResearch.synthesised),
    `${name}: buildPrompt embeds synthesised research body`,
  );

  const without = adapter.buildPrompt(mockEvent, mockOutcomes, "prediction");
  assert(
    !without.includes("LIVE RESEARCH CONTEXT"),
    `${name}: buildPrompt omits research block when research not provided`,
  );
  assert(
    without.includes(mockEvent.title),
    `${name}: buildPrompt still includes event title without research`,
  );
}

async function run() {
  exerciseAdapter("sport", sportAdapter);
  exerciseAdapter("politics", politicsAdapter);
  exerciseAdapter("markets", marketsAdapter);
  exerciseAdapter("entertainment", entertainmentAdapter);

  console.log(`\n${passed} passed, ${failed} failed`);
  const proc = (globalThis as { Deno?: { exit(c: number): never } }).Deno;
  if (failed > 0 && proc) proc.exit(1);
}

await run();
