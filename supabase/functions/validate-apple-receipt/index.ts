// POST /functions/v1/validate-apple-receipt
//
// Called by the mobile app immediately after a successful Apple IAP
// purchase. Verifies the StoreKit 2 JWS signedTransaction (preferred) or
// legacy receiptData, maps the productId to a tier/cadence via
// iap_products, enforces the single-subscription rule, and upserts the
// subscriptions row keyed on apple_original_transaction_id.
//
// Auth: caller JWT required. DB writes via service-role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireAuthenticatedUser } from "../_shared/auth.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";
import {
  AppleVerificationError,
  appleCredentialsStatus,
  verifyAppleJWS,
  verifyAppleReceipt,
  type AppleTransaction,
} from "../_shared/apple.ts";

interface Body {
  signedTransaction?: string;
  receiptData?: string;
}

function readEnv(name: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get(name);
}

Deno.serve(async (req: Request) => {
  const cors = handleCorsPreflight(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const url = readEnv("SUPABASE_URL");
  const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return errorResponse("Supabase env missing", 500);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  let authed;
  try { authed = await requireAuthenticatedUser(req, supabase); }
  catch (resp) { return resp as Response; }

  let body: Body;
  try { body = await req.json(); }
  catch { return errorResponse("invalid JSON body"); }

  const creds = appleCredentialsStatus();
  if (!body.signedTransaction && !body.receiptData) {
    return errorResponse("signedTransaction or receiptData is required");
  }
  // Graceful failure when Apple credentials are absent. We can still decode
  // a JWS without APPLE_BUNDLE_ID (no claim match), but legacy needs
  // APPLE_SHARED_SECRET.
  if (body.receiptData && !creds.legacyReady) {
    return errorResponse(
      "Apple credentials are not configured on this environment (APPLE_SHARED_SECRET missing). Legacy receipt verification unavailable.",
      503,
    );
  }

  let tx: AppleTransaction;
  try {
    tx = body.signedTransaction
      ? await verifyAppleJWS(body.signedTransaction)
      : await verifyAppleReceipt(body.receiptData!);
  } catch (e) {
    const err = e as AppleVerificationError;
    console.error("[validate-apple-receipt] verification failed:", err.message);
    return errorResponse(err.message, err.status ?? 400);
  }

  // Map productId -> tier/cadence via iap_products (service-role read).
  const { data: product, error: productErr } = await supabase
    .from("iap_products")
    .select("product_id, platform, tier, cadence, amount_minor_units, currency, is_active")
    .eq("platform", "apple")
    .eq("product_id", tx.productId)
    .maybeSingle();

  if (productErr) {
    console.error("[validate-apple-receipt] iap_products read failed:", productErr.message);
    return errorResponse(productErr.message, 500);
  }
  if (!product || !product.is_active) {
    return errorResponse(`Unknown or inactive Apple product: ${tx.productId}`, 400);
  }

  // Single-subscription guard: block if the user already has an active sub
  // on another platform.
  const { data: platformRes, error: platformErr } = await supabase
    .rpc("user_active_subscription_platform", { p_user_id: authed.user_id });
  if (platformErr) {
    console.error("[validate-apple-receipt] platform RPC failed:", platformErr.message);
    return errorResponse(platformErr.message, 500);
  }
  const existingPlatform = platformRes as string | null;
  if (existingPlatform && existingPlatform !== "apple") {
    return errorResponse(
      "You already have an active subscription on another platform. Manage it there.",
      409,
      { existing_platform: existingPlatform },
    );
  }

  // Derive status.
  const now = Date.now();
  const expiresMs = tx.expiresDate ? new Date(tx.expiresDate).getTime() : null;
  let status: "trialing" | "active" | "canceled";
  if (tx.inTrialPeriod && (!expiresMs || expiresMs > now)) {
    status = "trialing";
  } else if (expiresMs && expiresMs <= now) {
    status = "canceled";
  } else {
    status = "active";
  }

  // Upsert subscriptions row keyed on apple_original_transaction_id.
  // CHECK constraint subscriptions_platform_shape requires stripe ids NULL
  // for apple rows - we explicitly set them to null on insert.
  const upsertRow = {
    user_id: authed.user_id,
    billing_platform: "apple" as const,
    apple_original_transaction_id: tx.originalTransactionId,
    google_purchase_token: null,
    stripe_subscription_id: null,
    stripe_customer_id: null,
    stripe_price_id: null,
    tier: product.tier,
    cadence: product.cadence,
    status,
    current_period_start: tx.purchaseDate,
    current_period_end: tx.expiresDate,
    trial_end: status === "trialing" ? tx.expiresDate : null,
    trial_start: status === "trialing" ? tx.purchaseDate : null,
    cancel_at_period_end: false,
    canceled_at: status === "canceled" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { data: subRow, error: upsertErr } = await supabase
    .from("subscriptions")
    .upsert(upsertRow, { onConflict: "apple_original_transaction_id" })
    .select("id, status, tier, cadence, current_period_end, billing_platform")
    .single();
  if (upsertErr) {
    console.error("[validate-apple-receipt] subscriptions upsert failed:", upsertErr.message);
    return errorResponse(upsertErr.message, 500);
  }

  return jsonResponse({
    ok: true,
    subscription: subRow,
    environment: tx.environment,
  });
});
