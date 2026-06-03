// Stripe SDK initialization + small helpers shared across the
// stripe-webhook, create-checkout-session, and create-customer-portal-session
// edge functions.

import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";

/**
 * Returns a configured Stripe client. Throws if STRIPE_SECRET_KEY is unset.
 */
export function getStripeClient(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key || key.trim().length === 0) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/**
 * Maps a Stripe subscription status to our internal enum.
 * Identity mapping; falls back to "incomplete" for unknown values.
 */
export function mapStripeStatus(stripeStatus: string): string {
  const allowed = [
    "trialing", "active", "past_due", "canceled", "unpaid",
    "incomplete", "incomplete_expired", "paused",
  ];
  if (allowed.includes(stripeStatus)) return stripeStatus;
  console.warn(`[stripe] unknown subscription status "${stripeStatus}", defaulting to "incomplete"`);
  return "incomplete";
}

/**
 * Given a price_id, look up the tier from prophiq_prices.
 * Returns null if the price_id is unknown.
 */
export async function inferTierFromPriceId(
  supabase: {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { tier: string } | null }>;
        };
      };
    };
  },
  priceId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("prophiq_prices")
    .select("tier")
    .eq("stripe_price_id", priceId)
    .maybeSingle();
  return data?.tier ?? null;
}

/**
 * Convert a Unix timestamp (Stripe format) to an ISO string for Postgres.
 */
export function stripeTimestampToIso(unix: number | null | undefined): string | null {
  if (typeof unix !== "number") return null;
  return new Date(unix * 1000).toISOString();
}

/**
 * Extracts the current period start/end from a Stripe Subscription.
 *
 * In Stripe API version 2026-05-27 and later, current_period_start/end were
 * moved from the Subscription object onto SubscriptionItem objects (since
 * theoretically each item can have its own billing period). We always create
 * single-item subscriptions, so reading from the first item is correct.
 *
 * Falls back to the subscription-level fields for older API versions / robustness.
 */
export function extractSubscriptionPeriod(sub: Stripe.Subscription): {
  current_period_start: number | null;
  current_period_end: number | null;
} {
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & {
    current_period_start?: number;
    current_period_end?: number;
  }) | undefined;

  const start = item?.current_period_start
    ?? (sub as Stripe.Subscription & { current_period_start?: number }).current_period_start
    ?? null;
  const end = item?.current_period_end
    ?? (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end
    ?? null;

  return { current_period_start: start, current_period_end: end };
}
