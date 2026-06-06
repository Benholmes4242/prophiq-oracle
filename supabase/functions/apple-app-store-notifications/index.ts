// POST /functions/v1/apple-app-store-notifications
//
// ASSN V2 webhook. Apple calls this server-to-server; deploy with
// --no-verify-jwt. The body is { signedPayload: <JWS> }.
//
// Idempotency anchor: iap_webhook_events.notification_id. We record the
// event row even on handler error (same discipline as stripe-webhook).
//
// URL to register in App Store Connect once Apple enrolment lands:
//   https://rkktqrqsmoumnklvsahg.supabase.co/functions/v1/apple-app-store-notifications

import { getServiceClient } from "../_shared/supabaseClient.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";
import {
  AppleVerificationError,
  verifyAppleNotification,
  type AppleNotificationDecoded,
} from "../_shared/apple.ts";

interface SubsUpdate {
  status?: "active" | "canceled" | "past_due" | "trialing";
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  canceled_at?: string | null;
  updated_at?: string;
  notes?: string;
}

function mapNotification(n: AppleNotificationDecoded): { update: SubsUpdate; notify: null | { severity: string; title: string; body: string } } {
  const type = n.notificationType;
  const sub = n.subtype ?? "";
  const expires = n.transaction?.expiresDate ?? null;
  const now = new Date().toISOString();

  switch (type) {
    case "SUBSCRIBED":
    case "DID_RENEW":
      return {
        update: { status: "active", current_period_end: expires, cancel_at_period_end: false, canceled_at: null, updated_at: now },
        notify: null,
      };
    case "DID_CHANGE_RENEWAL_STATUS":
      // Subtype AUTO_RENEW_DISABLED -> cancel_at_period_end=true (stays
      // active until expiry). AUTO_RENEW_ENABLED -> revert that flag.
      if (sub === "AUTO_RENEW_DISABLED") {
        return { update: { cancel_at_period_end: true, updated_at: now }, notify: null };
      }
      return { update: { cancel_at_period_end: false, updated_at: now }, notify: null };
    case "EXPIRED":
    case "GRACE_PERIOD_EXPIRED":
      return {
        update: { status: "canceled", canceled_at: now, updated_at: now },
        notify: { severity: "warning", title: "Apple subscription expired", body: `Original transaction ${n.transaction?.originalTransactionId ?? "(unknown)"}` },
      };
    case "REFUND":
      return {
        update: { status: "canceled", canceled_at: now, updated_at: now, notes: "Refunded via App Store" },
        notify: { severity: "warning", title: "Apple subscription refunded", body: `Original transaction ${n.transaction?.originalTransactionId ?? "(unknown)"}` },
      };
    case "DID_FAIL_TO_RENEW":
      return { update: { status: "past_due", updated_at: now }, notify: null };
    default:
      return { update: {}, notify: null };
  }
}

Deno.serve(async (req: Request) => {
  const cors = handleCorsPreflight(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let envelope: { signedPayload?: string };
  try { envelope = await req.json(); }
  catch { return errorResponse("invalid JSON body"); }
  if (!envelope.signedPayload) return errorResponse("signedPayload is required");

  let decoded: AppleNotificationDecoded;
  try { decoded = await verifyAppleNotification(envelope.signedPayload); }
  catch (e) {
    const err = e as AppleVerificationError;
    console.error("[apple-assn] verify failed:", err.message);
    return errorResponse(err.message, err.status ?? 400);
  }

  if (!decoded.notificationUUID) {
    return errorResponse("notification payload missing notificationUUID");
  }

  const service = getServiceClient();

  // Idempotency: short-circuit if we've already seen this notification UUID.
  const { data: existing } = await service
    .from("iap_webhook_events")
    .select("notification_id")
    .eq("notification_id", decoded.notificationUUID)
    .maybeSingle();
  if (existing) {
    return jsonResponse({ ok: true, duplicate: true });
  }

  const mapping = mapNotification(decoded);
  let handlerErr: string | null = null;

  if (Object.keys(mapping.update).length > 0 && decoded.transaction?.originalTransactionId) {
    const { error: updErr } = await service
      .from("subscriptions")
      .update(mapping.update)
      .eq("apple_original_transaction_id", decoded.transaction.originalTransactionId);
    if (updErr) {
      handlerErr = updErr.message;
      console.error("[apple-assn] subscriptions update failed:", updErr.message);
    }
  }

  if (mapping.notify) {
    const dedupKey = `apple:${decoded.notificationType}:${decoded.transaction?.originalTransactionId ?? decoded.notificationUUID}`;
    const { error: notifyErr } = await service.rpc("raise_admin_notification", {
      p_severity: mapping.notify.severity,
      p_category: "billing",
      p_title: mapping.notify.title,
      p_body: mapping.notify.body,
      p_source: "apple-app-store-notifications",
      p_target_url: null,
      p_dedup_key: dedupKey,
      p_metadata: {
        notification_type: decoded.notificationType,
        subtype: decoded.subtype,
        original_transaction_id: decoded.transaction?.originalTransactionId ?? null,
      },
    });
    if (notifyErr) console.error("[apple-assn] raise_admin_notification failed:", notifyErr.message);
  }

  // Record the event row regardless of handler error so we never reprocess.
  const { error: recErr } = await service.from("iap_webhook_events").insert({
    notification_id: decoded.notificationUUID,
    platform: "apple",
    notification_type: decoded.notificationType,
    payload: decoded.raw,
  });
  if (recErr) console.error("[apple-assn] iap_webhook_events insert failed:", recErr.message);

  if (handlerErr) return errorResponse(handlerErr, 500);
  return jsonResponse({ ok: true });
});
