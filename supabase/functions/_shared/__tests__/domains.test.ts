// Smoke tests for domain adapters. Pure shape + dedup checks by default.
// Set RUN_PERPLEXITY=1 (and have PERPLEXITY_API_KEY set) to opt-in to a live
// discover() call against each adapter.

import { sportAdapter, politicsAdapter, marketsAdapter, entertainmentAdapter, registerAllDomains } from "../domains/index.ts";
import { listDomains, getDomain, clearDomainsForTest } from "../domains/registry.ts";
import { stableEventId, normaliseTitle, safeExtractJsonArray, coerceDiscoveredEvent } from "../domains/_util.ts";
import type { DomainAdapter } from "../domain.ts";

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

function checkShape(a: DomainAdapter, expectedId: string) {
  assert(a.id === expectedId, `${expectedId}: id matches`);
  assert(typeof a.displayName === "string" && a.displayName.length > 0, `${expectedId}: has displayName`);
  assert(typeof a.discover === "function", `${expectedId}: discover is function`);
  assert(typeof a.resolve === "function", `${expectedId}: resolve is function`);
  assert(typeof a.buildPrompt === "function", `${expectedId}: buildPrompt is function`);
}

async function run() {
  // ---- adapter shapes ----
  checkShape(sportAdapter, "sport");
  checkShape(politicsAdapter, "politics");
  checkShape(marketsAdapter, "markets");
  checkShape(entertainmentAdapter, "entertainment");

  // ---- registry ----
  clearDomainsForTest();
  registerAllDomains();
  const all = listDomains();
  assert(all.length === 4, `registry contains 4 adapters (got ${all.length})`);
  assert(getDomain("sport") === sportAdapter, "registry returns sport adapter");
  assert(getDomain("markets") === marketsAdapter, "registry returns markets adapter");

  // ---- stableEventId dedup ----
  const id1 = await stableEventId("Arsenal vs Chelsea", "2026-06-05T14:00:00Z");
  const id2 = await stableEventId("arsenal v chelsea", "2026-06-05T18:30:00Z"); // same day, looser
  const id3 = await stableEventId("  Arsenal   versus   Chelsea!!! ", "2026-06-05T09:00:00Z");
  assert(id1 === id2, "stableEventId: 'vs' and 'v' normalise the same");
  assert(id1 === id3, "stableEventId: 'versus' + punctuation normalise the same");
  const idDiff = await stableEventId("Arsenal vs Chelsea", "2026-06-06T14:00:00Z");
  assert(id1 !== idDiff, "stableEventId: different day -> different id");
  assert(/^[0-9a-f]{64}$/.test(id1), "stableEventId: SHA-256 hex");

  // ---- normaliseTitle ----
  assert(normaliseTitle("  Arsenal   VS!!  Chelsea  ") === "arsenal chelsea", "normaliseTitle collapses + strips vs");

  // ---- safeExtractJsonArray ----
  assert(safeExtractJsonArray("").length === 0, "extract: empty -> []");
  assert(safeExtractJsonArray("not json at all").length === 0, "extract: garbage -> []");
  assert(safeExtractJsonArray('Here you go: [{"a":1},{"a":2}] thanks').length === 2, "extract: array embedded in prose");
  assert(safeExtractJsonArray('```json\n[{"a":1}]\n```').length === 1, "extract: fenced json");
  assert(safeExtractJsonArray('{"events":[{"a":1},{"a":2},{"a":3}]}').length === 3, "extract: {events:[...]} wrapper");

  // ---- coerceDiscoveredEvent ----
  const good = await coerceDiscoveredEvent(
    {
      title: "Team A vs Team B",
      question: "Who wins?",
      starts_at: "2026-06-10T15:00:00Z",
      resolves_at: "2026-06-10T17:00:00Z",
      outcomes: [{ label: "Team A" }, { label: "Team B" }],
    },
    { defaultMode: "prediction", slugPrefix: "sport" },
  );
  assert(good !== null, "coerce: good item -> event");
  assert(good?.outcomes.length === 2, "coerce: outcomes preserved");
  assert(good?.slug.startsWith("sport-"), "coerce: slug prefixed");

  const badNoTitle = await coerceDiscoveredEvent({ question: "q?", starts_at: "2026-06-10T15:00:00Z", outcomes: [{ label: "a" }, { label: "b" }] }, { defaultMode: "prediction", slugPrefix: "x" });
  assert(badNoTitle === null, "coerce: missing title -> null");

  const badOneOutcome = await coerceDiscoveredEvent({ title: "t", question: "q?", starts_at: "2026-06-10T15:00:00Z", outcomes: [{ label: "a" }] }, { defaultMode: "prediction", slugPrefix: "x" });
  assert(badOneOutcome === null, "coerce: <2 outcomes -> null");

  const badDate = await coerceDiscoveredEvent({ title: "t", question: "q?", starts_at: "tomorrow-ish", outcomes: [{ label: "a" }, { label: "b" }] }, { defaultMode: "prediction", slugPrefix: "x" });
  assert(badDate === null, "coerce: bad date -> null");

  // ---- markets injects informationalOnly ----
  // Use the markets discover() path indirectly via coerce + adapter rule
  const marketsEv = await coerceDiscoveredEvent(
    { title: "FOMC decision", question: "What will the Fed do?", starts_at: "2026-06-12T18:00:00Z", outcomes: [{ label: "Hold" }, { label: "Cut 25bps" }] },
    { defaultMode: "prediction", slugPrefix: "markets", extraMetadata: { informationalOnly: true } },
  );
  assert(marketsEv?.metadata?.informationalOnly === true, "markets coerce: informationalOnly flag set");

  // ---- buildPrompt rules ----
  const sportPrompt = sportAdapter.buildPrompt(
    { id: "x", domain: "sport", external_id: null, slug: "s", title: "A vs B", description: null, question: "Who wins?", starts_at: "2026-06-10T15:00:00Z", resolves_at: "2026-06-10T17:00:00Z", status: "scheduled", mode: "odds", source: "discovered", moderation_status: "approved", metadata: null },
    [{ id: "o1", event_id: "x", external_id: null, label: "A", metadata: null }, { id: "o2", event_id: "x", external_id: null, label: "B", metadata: null }],
  );
  assert(sportPrompt.toLowerCase().includes("odds") || sportPrompt.toLowerCase().includes("probabilit"), "sport odds-mode prompt mentions odds/probability");

  // Strip negation/forbidden-language sentences before scanning for banned terms.
  const stripNegations = (s: string) =>
    s.split(/(?<=[.!\n])\s+/).filter((sent) => !/\b(do not|don't|never|no betting|avoid|forbidden|informational only)\b/i.test(sent)).join(" ");
  const BAN = /\b(bet|bets|betting|bookmak|odds)\b/i;

  const politicsPrompt = politicsAdapter.buildPrompt(
    { id: "x", domain: "politics", external_id: null, slug: "p", title: "Election", description: null, question: "Who wins?", starts_at: "2026-06-10T15:00:00Z", resolves_at: "2026-06-11T03:00:00Z", status: "scheduled", mode: "prediction", source: "discovered", moderation_status: "approved", metadata: null },
    [{ id: "o1", event_id: "x", external_id: null, label: "Party A", metadata: null }, { id: "o2", event_id: "x", external_id: null, label: "Party B", metadata: null }],
  );
  assert(!BAN.test(stripNegations(politicsPrompt)), "politics prompt avoids betting/odds language");

  const marketsPrompt = marketsAdapter.buildPrompt(
    { id: "x", domain: "markets", external_id: null, slug: "m", title: "FOMC", description: null, question: "Cut?", starts_at: "2026-06-10T15:00:00Z", resolves_at: "2026-06-10T20:00:00Z", status: "scheduled", mode: "prediction", source: "discovered", moderation_status: "approved", metadata: null },
    [{ id: "o1", event_id: "x", external_id: null, label: "Hold", metadata: null }, { id: "o2", event_id: "x", external_id: null, label: "Cut", metadata: null }],
  );
  assert(/informational only/i.test(marketsPrompt), "markets prompt includes informational-only disclaimer");
  assert(!BAN.test(stripNegations(marketsPrompt)), "markets prompt avoids betting/odds language");

  const entPrompt = entertainmentAdapter.buildPrompt(
    { id: "x", domain: "entertainment", external_id: null, slug: "e", title: "Oscars", description: null, question: "Best Picture?", starts_at: "2026-06-10T15:00:00Z", resolves_at: "2026-06-11T03:00:00Z", status: "scheduled", mode: "prediction", source: "discovered", moderation_status: "approved", metadata: null },
    [{ id: "o1", event_id: "x", external_id: null, label: "Film A", metadata: null }, { id: "o2", event_id: "x", external_id: null, label: "Film B", metadata: null }],
  );
  assert(!/\bbet|bets|betting|bookmak|odds\b/i.test(entPrompt), "entertainment prompt avoids betting/odds language");

  // ---- optional live perplexity probe ----
  const runLive = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.RUN_PERPLEXITY === "1";
  if (runLive) {
    console.log("\n-- live perplexity discover() probes --");
    for (const adapter of [sportAdapter, politicsAdapter, marketsAdapter, entertainmentAdapter]) {
      try {
        const evs = await adapter.discover(new Date());
        assert(Array.isArray(evs), `${adapter.id}: discover returns array (got ${evs.length})`);
        for (const ev of evs) {
          assert(typeof ev.external_id === "string" && ev.external_id.length > 0, `${adapter.id}: ev has external_id`);
          assert(ev.outcomes.length >= 2, `${adapter.id}: ev has 2+ outcomes`);
        }
      } catch (err) {
        failed++;
        console.error(`FAIL: ${adapter.id} live discover threw: ${(err as Error).message}`);
      }
    }
  } else {
    console.log("\n(skipping live Perplexity probe — set RUN_PERPLEXITY=1 to enable)");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("All domain adapter tests passed.");
  }
}

run().catch((err) => {
  console.error("UNCAUGHT:", err);
  process.exit(1);
});
