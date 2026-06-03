import { supabase } from "./supabase";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1`;

async function getJwt(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const jwt = session?.access_token;
  if (!jwt) throw new Error("Not authenticated");
  return jwt;
}

/**
 * Creates a Stripe Checkout session and returns the URL to redirect to.
 * Caller is responsible for window.location.assign(url).
 */
export async function createCheckoutSession(priceId: string): Promise<string> {
  const jwt = await getJwt();
  const res = await fetch(`${FUNCTIONS_BASE}/create-checkout-session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ price_id: priceId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Checkout session creation failed (${res.status})`);
  }

  const { url } = await res.json();
  if (typeof url !== "string") throw new Error("No URL returned");
  return url;
}

/**
 * Creates a Stripe Customer Portal session for self-service management.
 */
export async function createCustomerPortalSession(): Promise<string> {
  const jwt = await getJwt();
  const res = await fetch(`${FUNCTIONS_BASE}/create-customer-portal-session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Customer portal session creation failed (${res.status})`);
  }

  const { url } = await res.json();
  if (typeof url !== "string") throw new Error("No URL returned");
  return url;
}
