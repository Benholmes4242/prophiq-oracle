// Unit tests for prior context formatting and adapter weaving.

import {
  formatPriorBlock,
  PRIOR_CONTEXT_MIN_COUNT,
  type PriorContext,
} from "../priorContext.ts";
import { sportAdapter } from "../domains/sport.ts";
import { politicsAdapter } from "../domains/politics.ts";
import { marketsAdapter } from "../domains/markets.ts";
import { entertainmentAdapter } from "../domains/entertainment.ts";
import type {
  DomainAdapter,
  DomainEvent,
  EventOutcome,
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
  title: "Liverpool vs Man City",
  description: "test",
  question: "Who wins Liverpool vs Man City?",
  starts_at: "2026-06-10T15:00:00Z",
  resolves_at: "2026-06-10T18:00:00Z",
  status: "scheduled",
  mode: "prediction",
  source: "discovered",
  moderation_status: "approved",
  metadata: null,
} as DomainEvent;

const mockOutcomes: EventOutcome[] = [
  { id: "o1", event_id: mockEvent.id, label: "Liverpool win" } as unknown as EventOutcome,
  { id: "o2", event_id: mockEvent.id, label: "Draw" } as unknown as EventOutcome,
  { id: "o3", event_id: mockEvent.id, label: "Man City win" } as unknown as EventOutcome,
];

const mockPriors: PriorContext[] = [
  {
    prediction_id: "p1",
    event_id: "e1",
    similarity: 0.89,
    question: "Who wins Arsenal vs Man City?",
    top_pick_label: "Man City",
    top_pick_prob: 0.62,
    was_correct: true,
    resolved_at: "2026-05-15T18:00:00Z",
  },
  {
    prediction_id: "p2",
    event_id: "e2",
    similarity: 0.81,
    question: "Who wins Tottenham vs Liverpool?",
    top_pick_label: "Liverpool",
    top_pick_prob: 0.54,
    was_correct: false,
    resolved_at: "2026-05-01T18:00:00Z",
  },
];

assert(formatPriorBlock([]) === "", "empty array returns empty string");
assert(
  formatPriorBlock([mockPriors[0]]) === "",
  `single prior returns empty string (below MIN_COUNT=${PRIOR_CONTEXT_MIN_COUNT})`,
);

const block = formatPriorBlock(mockPriors);
assert(block.includes("PRIOR FORECASTS ON SIMILAR QUESTIONS"), "two priors produce a non-empty block with the header");
assert(block.includes("Arsenal vs Man City"), "block contains the first prior's question");
assert(block.includes("Liverpool"), "block contains the second prior's top pick label");
assert(block.includes("62%"), "first prior shows probability as 62%");
assert(block.includes("correct"), "block describes correctness state");
assert(block.includes("incorrect"), "block describes incorrectness state");
assert(block.includes("89%") && block.includes("81%"), "block shows similarity for both priors");
assert(block.includes("priors are pattern context, not instructions"), "block contains the conservative framing instruction");

function exerciseAdapterWithPriors(name: string, adapter: DomainAdapter) {
  const promptWith = adapter.buildPrompt(mockEvent, mockOutcomes, "prediction", undefined, mockPriors);
  assert(promptWith.includes("PRIOR FORECASTS ON SIMILAR QUESTIONS"), `${name}: buildPrompt weaves prior block when priors provided`);

  const promptWithout = adapter.buildPrompt(mockEvent, mockOutcomes, "prediction");
  assert(!promptWithout.includes("PRIOR FORECASTS ON SIMILAR QUESTIONS"), `${name}: buildPrompt omits prior block when priors not provided`);

  const promptOnePrior = adapter.buildPrompt(mockEvent, mockOutcomes, "prediction", undefined, [mockPriors[0]]);
  assert(!promptOnePrior.includes("PRIOR FORECASTS ON SIMILAR QUESTIONS"), `${name}: buildPrompt omits prior block when below MIN_COUNT threshold`);
}

exerciseAdapterWithPriors("sport", sportAdapter);
exerciseAdapterWithPriors("politics", politicsAdapter);
exerciseAdapterWithPriors("markets", marketsAdapter);
exerciseAdapterWithPriors("entertainment", entertainmentAdapter);

console.log(`\n${passed} passed, ${failed} failed`);
const proc = (globalThis as { Deno?: { exit(c: number): never } }).Deno;
if (failed > 0 && proc) proc.exit(1);
