import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { requireAuthenticatedUser } from "../_shared/auth.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteUrl = Deno.env.get("SITE_URL")!;

interface RequestBody {
  price_id?: string;
  success_path?: string;
  cancel_path?: string;
}

const DEFAULT_SUCCESS_PATH = "/?subscribed=true";
const DEFAULT_CANCEL_PATH = "/pricing?canceled=true";
const TRIAL_DAYS = 7;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  let authedUser;
  try {
    authedUser = await requireAuthenticatedUser(req, supabase);
  } catch (response) {
    return response as Response;
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.price_id) {
    return new Response(JSON.stringify({ error: "Missing price_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: priceRow } = await supabase
    .from("prophiq_prices")
    .select("stripe_price_id, tier")
    .eq("stripe_price_id", body.price_id)
    .eq("is_active", true)
    .maybeSingle();

  if (!priceRow) {
    return new Response(JSON.stringify({ error: "Unknown or inactive price_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stripe = getStripeClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id, email")
    .eq("id", authedUser.user_id)
    .maybeSingle();

  const profileRow = profile as { stripe_customer_id: string | null; email: string | null } | null;
  let stripeCustomerId = profileRow?.stripe_customer_id ?? null;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: profileRow?.email ?? authedUser.email ?? undefined,
      metadata: { supabase_user_id: authedUser.user_id },
    });
    stripeCustomerId = customer.id;
    await supabase
      .from("profiles")
      .update({ stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() })
      .eq("id", authedUser.user_id);
  }

  const successPath = body.success_path && body.success_path.startsWith("/")
    ? body.success_path
    : DEFAULT_SUCCESS_PATH;
  const cancelPath = body.cancel_path && body.cancel_path.startsWith("/")
    ? body.cancel_path
    : DEFAULT_CANCEL_PATH;
  const joiner = successPath.includes("?") ? "&" : "?";
  const successUrl = `${siteUrl}${successPath}${joiner}session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${siteUrl}${cancelPath}`;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    line_items: [{ price: body.price_id, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      metadata: { supabase_user_id: authedUser.user_id },
    },
    metadata: { user_id: authedUser.user_id, price_id: body.price_id },
    allow_promotion_codes: true,
    automatic_tax: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
  });

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
