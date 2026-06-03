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
