// Unit tests for the embedding helper. No real API calls.

import { buildEmbeddingInput, EMBEDDING_DIMS } from "../embeddings.ts";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`ok : ${msg}`); }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

assert(
  buildEmbeddingInput({ title: "Bahrain GP 2026", question: "Will Verstappen win?" })
    === "Bahrain GP 2026. Will Verstappen win?",
  "concatenates title and question with period separator",
);
assert(
  buildEmbeddingInput({ title: "  spaced  ", question: "  trimmed  " })
    === "spaced. trimmed",
  "trims whitespace on both sides",
);
assert(
  buildEmbeddingInput({ title: "", question: "Just a question?" })
    === "Just a question?",
  "falls back to question when title is empty",
);
assert(
  buildEmbeddingInput({ title: "Just a title", question: "" })
    === "Just a title",
  "falls back to title when question is empty",
);
assert(
  buildEmbeddingInput({ title: "", question: "" }) === "",
  "returns empty string when both inputs are empty",
);
assert(EMBEDDING_DIMS === 1536, "EMBEDDING_DIMS exported as 1536");

console.log(`\n${passed} passed, ${failed} failed`);
const proc = (globalThis as { Deno?: { exit(c: number): never } }).Deno;
if (failed > 0 && proc) proc.exit(1);
