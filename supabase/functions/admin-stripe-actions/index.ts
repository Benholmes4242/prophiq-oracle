// POST /functions/v1/admin-stripe-actions
//
// Admin-initiated Stripe operations (force-cancel, refund). Consolidates
// all admin Stripe secret usage into one function.
//
// Security crux (brief II.C section 7): authorize as the CALLER (so
// get_admin_role()/admin_require_role() see the right auth.uid()), but
// perform the actual Stripe + audit work via the service role.
//
// Body: { action: 'force_cancel' | 'refund', user_id: uuid,
//         charge_id?: string, reason: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getStripeClient } from "../_shared/stripe.ts";
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";

interface Body {
  action?: "force_cancel" | "refund";
  user_id?: string;
  charge_id?: string;
  reason?: string;
}

function readEnv(name: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get(name);
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: Body;
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body"); }

  const action = body.action;
  const userId = body.user_id?.trim();
  const reason = body.reason?.trim();
  if (!action || !["force_cancel", "refund"].includes(action)) {
    return errorResponse("action must be 'force_cancel' or 'refund'");
  }
  if (!userId) return errorResponse("user_id required");
  if (!reason) return errorResponse("reason required");

  // --- Dual-client setup -----------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return errorResponse("Missing Authorization", 401);

  const url = readEnv("SUPABASE_URL");
  const anonKey = readEnv("SUPABASE_ANON_KEY") ?? readEnv("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !anonKey) return errorResponse("Supabase env missing", 500);

  // Caller-context client: used ONLY for the role check + audit RPC so
  // auth.uid() resolves to the calling admin.
  const callerClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  // Service-role client: Stripe-followup DB reads + state lookups.
  const service = getServiceClient();

  // --- Authorize as caller ---------------------------------------------------
  const { error: roleErr } = await callerClient.rpc("admin_require_role", {
    p_roles: ["super_admin", "admin"],
  });
  if (roleErr) {
    return errorResponse(roleErr.message ?? "Forbidden", 403);
  }

  // --- Stripe call -----------------------------------------------------------
  const stripe = getStripeClient();

  try {
    if (action === "force_cancel") {
      const { data: sub, error: subErr } = await service
        .from("subscriptions")
        .select("id, stripe_subscription_id, status")
        .eq("user_id", userId)
        .in("status", ["active", "trialing", "past_due"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (subErr) return errorResponse(subErr.message, 500);
      if (!sub) return errorResponse("No active subscription for user", 404);

      const canceled = await stripe.subscriptions.cancel(sub.stripe_subscription_id);

      // DO NOT write the local subscriptions row here; stripe-webhook owns
      // that state transition. Just audit.
      const { error: logErr } = await callerClient.rpc("admin_log_stripe_action", {
        p_action: "subscription.force_cancel",
        p_target_id: userId,
        p_before_state: { status: sub.status, stripe_subscription_id: sub.stripe_subscription_id },
        p_after_state: { stripe_status: canceled.status, canceled_at: canceled.canceled_at },
        p_metadata: { reason },
      });
      if (logErr) console.error("[admin-stripe-actions] audit insert failed:", logErr.message);

      return jsonResponse({ ok: true, stripe_status: canceled.status });
    }

    if (action === "refund") {
      const chargeId = body.charge_id?.trim();
      if (!chargeId) return errorResponse("charge_id required for refund");

      const charge = await stripe.charges.retrieve(chargeId);
      const ageMs = Date.now() - (charge.created * 1000);
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      if (ageMs > THIRTY_DAYS) {
        return errorResponse("Charge is older than 30 days; refund window expired", 422);
      }

      const refund = await stripe.refunds.create({
        charge: chargeId,
        reason: "requested_by_customer",
      });

      const { error: logErr } = await callerClient.rpc("admin_log_stripe_action", {
        p_action: "subscription.refund",
        p_target_id: userId,
        p_before_state: { charge_id: chargeId, amount: charge.amount, currency: charge.currency },
        p_after_state: { refund_id: refund.id, refund_status: refund.status, amount: refund.amount },
        p_metadata: { reason, charge_id: chargeId },
      });
      if (logErr) console.error("[admin-stripe-actions] audit insert failed:", logErr.message);

      return jsonResponse({
        ok: true,
        refund_id: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
      });
    }

    return errorResponse("Unknown action", 400);
  } catch (err) {
    console.error("[admin-stripe-actions] stripe error:", err);
    const msg = err instanceof Error ? err.message : "Stripe call failed";
    return errorResponse(msg, 500);
  }
});
