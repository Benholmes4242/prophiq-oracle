// Gated live probe. Set ALLOW_LIVE_PROBES=1 to run.

if (Deno.env.get("ALLOW_LIVE_PROBES") !== "1") {
  console.log("skipped (set ALLOW_LIVE_PROBES=1 to run)");
  Deno.exit(0);
}

import { embedText, EMBEDDING_DIMS } from "../embeddings.ts";

const v = await embedText("Will Manchester City win the Premier League in 2026?");
console.log(`embedded: dims=${v.length}, first 3 values=${v.slice(0, 3).join(", ")}`);
if (v.length !== EMBEDDING_DIMS) {
  console.error("FAIL: dimension mismatch");
  Deno.exit(1);
}
console.log("ok: embedder returns 1536-dim vector");

const a = await embedText("Will Liverpool win the Premier League?");
const b = await embedText("Will Manchester United win the Premier League?");
const c = await embedText("Will the ECB cut interest rates in June?");

function cosine(x: number[], y: number[]) {
  let dot = 0, magX = 0, magY = 0;
  for (let i = 0; i < x.length; i++) {
    dot += x[i] * y[i];
    magX += x[i] * x[i];
    magY += y[i] * y[i];
  }
  return dot / (Math.sqrt(magX) * Math.sqrt(magY));
}

const simAB = cosine(a, b);
const simAC = cosine(a, c);
console.log(`sim(football, football) = ${simAB.toFixed(3)}`);
console.log(`sim(football, central bank) = ${simAC.toFixed(3)}`);
if (simAB <= simAC) {
  console.error("FAIL: similar texts should score higher than unrelated texts");
  Deno.exit(1);
}
console.log("ok: similarity ranking sanity check passes");
