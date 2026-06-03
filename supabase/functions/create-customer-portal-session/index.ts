import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { requireAuthenticatedUser } from "../_shared/auth.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteUrl = Deno.env.get("SITE_URL")!;

Deno.serve(async (req: Request) => {
  const cors = handleCorsPreflight(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
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
    return errorResponse("No Stripe customer for this user", 404);
  }

  const stripe = getStripeClient();
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: profileRow.stripe_customer_id,
    return_url: `${siteUrl}/account`,
  });

  return jsonResponse({ url: portalSession.url });
});
