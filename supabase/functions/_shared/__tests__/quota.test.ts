// Tests for the Brief CC get_user_quota_today RPC behavior.
//
// These are pure-logic tests that document the expected entitlement rules.
// Integration tests (calling the actual RPC against a Supabase instance)
// would need a separate test harness; this file documents the contract.

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`ok : ${msg}`); }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

function computeCap(
  subscription: { status: string; tier: string; daily_forecast_cap: number } | null,
): { cap: number; tier: string; is_trialing: boolean } {
  const FREE_CAP = 3;
  const TRIAL_CAP = 100;

  if (!subscription) {
    return { cap: FREE_CAP, tier: 'free', is_trialing: false };
  }

  const is_trialing = subscription.status === 'trialing';
  let cap: number;

  if (is_trialing) {
    cap = TRIAL_CAP;
  } else if (subscription.status === 'active' || subscription.status === 'past_due') {
    cap = subscription.daily_forecast_cap;
  } else {
    return { cap: FREE_CAP, tier: 'free', is_trialing: false };
  }

  return { cap, tier: subscription.tier, is_trialing };
}

function computeRemaining(used: number, cap: number): number {
  return Math.max(0, cap - used);
}

assert(computeCap(null).cap === 3, "no subscription -> 3/day");
assert(computeCap(null).tier === 'free', "no subscription -> tier free");
assert(computeCap(null).is_trialing === false, "no subscription -> not trialing");

assert(
  computeCap({ status: 'active', tier: 'standard', daily_forecast_cap: 25 }).cap === 25,
  "active standard -> 25/day",
);
assert(
  computeCap({ status: 'active', tier: 'pro', daily_forecast_cap: 100 }).cap === 100,
  "active pro -> 100/day",
);

assert(
  computeCap({ status: 'trialing', tier: 'standard', daily_forecast_cap: 25 }).cap === 100,
  "trialing standard -> 100/day (Pro experience during trial)",
);
assert(
  computeCap({ status: 'trialing', tier: 'pro', daily_forecast_cap: 100 }).cap === 100,
  "trialing pro -> 100/day",
);
assert(
  computeCap({ status: 'trialing', tier: 'standard', daily_forecast_cap: 25 }).is_trialing === true,
  "trialing -> is_trialing flag true",
);

assert(
  computeCap({ status: 'past_due', tier: 'standard', daily_forecast_cap: 25 }).cap === 25,
  "past_due standard -> 25/day (grace period)",
);
assert(
  computeCap({ status: 'past_due', tier: 'pro', daily_forecast_cap: 100 }).cap === 100,
  "past_due pro -> 100/day (grace period)",
);

assert(
  computeCap({ status: 'canceled', tier: 'standard', daily_forecast_cap: 25 }).cap === 3,
  "canceled -> 3/day (back to free)",
);
assert(
  computeCap({ status: 'canceled', tier: 'standard', daily_forecast_cap: 25 }).tier === 'free',
  "canceled -> tier becomes 'free' regardless of price tier",
);
assert(
  computeCap({ status: 'unpaid', tier: 'pro', daily_forecast_cap: 100 }).cap === 3,
  "unpaid -> 3/day",
);
assert(
  computeCap({ status: 'incomplete', tier: 'pro', daily_forecast_cap: 100 }).cap === 3,
  "incomplete -> 3/day",
);
assert(
  computeCap({ status: 'incomplete_expired', tier: 'pro', daily_forecast_cap: 100 }).cap === 3,
  "incomplete_expired -> 3/day",
);
assert(
  computeCap({ status: 'paused', tier: 'pro', daily_forecast_cap: 100 }).cap === 3,
  "paused -> 3/day",
);

assert(computeRemaining(0, 3) === 3, "0 used of 3 -> 3 remaining");
assert(computeRemaining(2, 3) === 1, "2 used of 3 -> 1 remaining");
assert(computeRemaining(3, 3) === 0, "3 used of 3 -> 0 remaining (capped)");
assert(computeRemaining(5, 3) === 0, "5 used of 3 -> 0 remaining (floored, never negative)");
assert(computeRemaining(50, 100) === 50, "50 used of 100 -> 50 remaining");

console.log(`\n${passed} passed, ${failed} failed`);
const proc = (globalThis as { Deno?: { exit(c: number): never } }).Deno;
if (failed > 0 && proc) proc.exit(1);
