import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { requireAuthenticatedUser } from "../_shared/auth.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteUrl = Deno.env.get("SITE_URL")!;

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", authedUser.user_id)
    .maybeSingle();

  const profileRow = profile as { stripe_customer_id: string | null } | null;
  if (!profileRow?.stripe_customer_id) {
    return new Response(JSON.stringify({ error: "No Stripe customer for this user" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stripe = getStripeClient();
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: profileRow.stripe_customer_id,
    return_url: `${siteUrl}/account`,
  });

  return new Response(JSON.stringify({ url: portalSession.url }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
