// Account deletion endpoint. Auth-gated. Cancels Stripe subscriptions,
// deletes the Stripe customer, then deletes the Supabase auth user
// (CASCADE removes profiles + subscriptions + any user_id refs).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { requireAuthenticatedUser } from "../_shared/auth.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";
import { sendEmail } from "../_shared/email.ts";
import { subscriptionCanceledEmail } from "../_shared/email-templates.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, stripe_customer_id, email")
    .eq("id", authedUser.user_id)
    .maybeSingle();

  if (profileError) {
    console.warn(`[delete-account] profile lookup failed: ${profileError.message}`);
    // Continue with deletion even if profile lookup fails.
  }

  const profileRow = profile as
    | { id: string; stripe_customer_id: string | null; email: string | null }
    | null;
  const stripeCustomerId = profileRow?.stripe_customer_id ?? null;

  // Send the cancellation email NOW, while we still have the user's email.
  // Once we delete the Supabase user below, CASCADE removes the profile, and
  // the stripe-webhook handler for customer.subscription.deleted won't be
  // able to find the email anymore (race condition). Best-effort: if email
  // send fails, continue with deletion; the user explicitly chose to delete.
  if (profileRow?.email) {
    try {
      const siteUrl = Deno.env.get("SITE_URL") ?? "https://prophiq.io";
      const template = subscriptionCanceledEmail({
        email: profileRow.email,
        siteUrl,
        reason: "user_canceled",
      });
      await sendEmail({
        to: profileRow.email,
        subject: template.subject,
        html: template.html,
      });
    } catch (err) {
      console.warn(`[delete-account] cancellation email failed: ${(err as Error).message}`);
    }
  }

  if (stripeCustomerId) {
    let stripe;
    try {
      stripe = getStripeClient();
    } catch (err) {
      console.warn(`[delete-account] Stripe client init failed: ${(err as Error).message}`);
    }

    if (stripe) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: stripeCustomerId,
          status: "all",
          limit: 100,
        });
        for (const sub of subs.data) {
          if (
            sub.status === "active" ||
            sub.status === "trialing" ||
            sub.status === "past_due"
          ) {
            await stripe.subscriptions.cancel(sub.id, {
              prorate: false,
              cancellation_details: { comment: "User account deleted via Prophiq" },
            });
          }
        }
      } catch (err) {
        console.warn(`[delete-account] subscription cancel failed: ${(err as Error).message}`);
      }

      try {
        await stripe.customers.del(stripeCustomerId);
      } catch (err) {
        console.warn(`[delete-account] Stripe customer delete failed: ${(err as Error).message}`);
      }
    }
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(
    authedUser.user_id,
  );

  if (deleteError) {
    console.error(`[delete-account] user delete failed: ${deleteError.message}`);
    return errorResponse(`Failed to delete account: ${deleteError.message}`, 500);
  }

  return jsonResponse({ success: true });
});
