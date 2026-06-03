import { extractSubscriptionPeriod, mapStripeStatus, stripeTimestampToIso } from "../stripe.ts";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`ok : ${msg}`); }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

// === mapStripeStatus ===
assert(mapStripeStatus("active") === "active", "active passes through");
assert(mapStripeStatus("trialing") === "trialing", "trialing passes through");
assert(mapStripeStatus("past_due") === "past_due", "past_due passes through");
assert(mapStripeStatus("canceled") === "canceled", "canceled passes through");
assert(mapStripeStatus("unpaid") === "unpaid", "unpaid passes through");
assert(mapStripeStatus("incomplete") === "incomplete", "incomplete passes through");
assert(mapStripeStatus("incomplete_expired") === "incomplete_expired", "incomplete_expired passes through");
assert(mapStripeStatus("paused") === "paused", "paused passes through");
assert(mapStripeStatus("totally-unknown") === "incomplete", "unknown statuses fall back to incomplete");
assert(mapStripeStatus("") === "incomplete", "empty string falls back to incomplete");

// === stripeTimestampToIso ===
const knownUnix = 1735689600; // 2025-01-01T00:00:00Z
const iso = stripeTimestampToIso(knownUnix);
assert(iso === "2025-01-01T00:00:00.000Z", `unix 1735689600 -> 2025-01-01T00:00:00.000Z (got ${iso})`);
assert(stripeTimestampToIso(null) === null, "null returns null");
assert(stripeTimestampToIso(undefined) === null, "undefined returns null");

console.log(`\n${passed} passed, ${failed} failed`);
const deno = (globalThis as { Deno?: { exit(c: number): never } }).Deno;
if (failed > 0 && deno) deno.exit(1);
