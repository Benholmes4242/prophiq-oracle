// Conformance test for the placeholder-gate implementations.
// Run with: bun supabase/functions/_shared/__tests__/placeholderConformance.test.ts
//
// Verifies:
//   1. Edge DISPLAY gate (isDisplayPlaceholder from placeholderPatterns.ts)
//      agrees with the fixture's displayPlaceholder column.
//   2. Edge PERSISTENCE gate (isPlaceholderLabel from outcomeQuality.ts)
//      agrees with the fixture's persistencePlaceholder column.
//   3. Frontend DISPLAY mirror (src/lib/placeholderOutcome.ts) agrees with
//      the edge DISPLAY gate — same fixture, same verdict.
//   4. Invariant: display ⊆ persistence (anything the display gate hides
//      must also be rejected by the broader persistence gate).
//
// The SQL function's parity is checked separately via
// db/tests/placeholder_gate_parity.sql (run after any gate change).

import { isDisplayPlaceholder } from "../placeholderPatterns.ts";
import { isPlaceholderLabel } from "../outcomeQuality.ts";
import { isPlaceholderOutcomeLabel } from "../../../../src/lib/placeholderOutcome.ts";
import { PLACEHOLDER_FIXTURE } from "./placeholderConformance.fixture.ts";

let failed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("ok  :", msg);
  }
}

for (const row of PLACEHOLDER_FIXTURE) {
  const display = isDisplayPlaceholder(row.label);
  check(
    display === row.displayPlaceholder,
    `display gate (edge) for ${JSON.stringify(row.label)}: expected ${row.displayPlaceholder}, got ${display}`,
  );

  const persistence = isPlaceholderLabel(row.label);
  check(
    persistence === row.persistencePlaceholder,
    `persistence gate for ${JSON.stringify(row.label)}: expected ${row.persistencePlaceholder}, got ${persistence}`,
  );

  const frontend = isPlaceholderOutcomeLabel(row.label);
  check(
    frontend === row.displayPlaceholder,
    `display gate (frontend mirror) for ${JSON.stringify(row.label)}: expected ${row.displayPlaceholder}, got ${frontend}`,
  );

  // Invariant: display ⊆ persistence
  if (row.displayPlaceholder) {
    check(
      row.persistencePlaceholder,
      `fixture invariant: ${JSON.stringify(row.label)} is a display-placeholder so it must also be a persistence-placeholder`,
    );
  }
}

if (failed > 0) {
  console.error(`\n${failed} conformance check(s) failed.`);
  // Exit non-zero so CI / `bun run` propagates the failure.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).process?.exit?.(1);
  throw new Error(`${failed} conformance check(s) failed`);
} else {
  console.log(`\nAll ${PLACEHOLDER_FIXTURE.length * 3} conformance checks passed.`);
}
