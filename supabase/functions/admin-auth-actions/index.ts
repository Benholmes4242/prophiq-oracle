// POST /functions/v1/admin-auth-actions
//
// Admin-initiated Supabase Auth admin operations:
//   * resend_otp  - send the target user a fresh sign-in OTP email
//                   (super_admin / admin / support)
//   * mfa_reset   - clear ANOTHER admin's MFA factors and stored recovery
//                   so they re-enrol cleanly (super_admin only)
//
// Authorization follows the dual-client pattern from admin-stripe-actions:
// caller-context client checks admin_require_role(); service-role client
// performs the privileged Auth admin call and writes the audit row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";

interface Body {
  action?: "resend_otp" | "mfa_reset";
  user_id?: string;
  target_user_id?: string;
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
  if (action !== "resend_otp" && action !== "mfa_reset") {
    return errorResponse("action must be 'resend_otp' or 'mfa_reset'");
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return errorResponse("Missing Authorization", 401);

  const url = readEnv("SUPABASE_URL");
  const anonKey = readEnv("SUPABASE_ANON_KEY") ?? readEnv("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !anonKey) return errorResponse("Supabase env missing", 500);

  const callerClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
  const service = getServiceClient();

  // ----- resend_otp -----
  if (action === "resend_otp") {
    const userId = body.user_id?.trim();
    if (!userId) return errorResponse("user_id required");

    const { error: roleErr } = await callerClient.rpc("admin_require_role", {
      p_roles: ["super_admin", "admin", "support"],
    });
    if (roleErr) return errorResponse(roleErr.message ?? "Forbidden", 403);

    const { data: targetData, error: getUserErr } = await service.auth.admin.getUserById(userId);
    if (getUserErr || !targetData?.user?.email) {
      return errorResponse("Target user not found or has no email", 404);
    }
    const email = targetData.user.email;

    const { error: otpErr } = await service.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (otpErr) {
      console.error("[admin-auth-actions] OTP send failed:", otpErr.message);
      return errorResponse(otpErr.message, 500);
    }

    const { error: logErr } = await callerClient.rpc("log_admin_action", {
      p_action: "user.resend_otp",
      p_target_type: "user",
      p_target_id: userId,
      p_before_state: null,
      p_after_state: { email },
      p_metadata: {},
    });
    if (logErr) console.error("[admin-auth-actions] audit insert failed:", logErr.message);

    return jsonResponse({ ok: true });
  }

  // ----- mfa_reset (super_admin only; targets ANOTHER admin) -----
  const targetUserId = body.target_user_id?.trim();
  if (!targetUserId) return errorResponse("target_user_id required");

  const { error: roleErr } = await callerClient.rpc("admin_require_role", {
    p_roles: ["super_admin"],
  });
  if (roleErr) return errorResponse(roleErr.message ?? "Forbidden", 403);

  // Confirm the target is actually an admin (don't let this be used to
  // tamper with arbitrary users' MFA).
  const { data: targetAdmin, error: targetErr } = await service
    .from("admin_users")
    .select("id, user_id")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (targetErr) return errorResponse(targetErr.message, 500);
  if (!targetAdmin) return errorResponse("Target is not an admin", 404);

  // List + delete the target's TOTP factors. Tolerate per-factor errors so a
  // single stuck factor doesn't block the reset.
  let factorsCleared = 0;
  try {
    const { data: factors, error: listErr } = await service.auth.admin.mfa
      .listFactors({ userId: targetUserId });
    if (listErr) {
      console.error("[admin-auth-actions] listFactors failed:", listErr.message);
    }
    for (const f of factors?.factors ?? []) {
      if (f.factor_type !== "totp") continue;
      const { error: delErr } = await service.auth.admin.mfa
        .deleteFactor({ userId: targetUserId, id: f.id });
      if (delErr) {
        console.error("[admin-auth-actions] deleteFactor failed:", delErr.message);
      } else {
        factorsCleared += 1;
      }
    }
  } catch (e) {
    console.error("[admin-auth-actions] mfa admin API threw:", (e as Error).message);
  }

  const { error: clearErr } = await service
    .from("admin_users")
    .update({
      recovery_code_hash: null,
      recovery_code_set_at: null,
      mfa_last_verified_at: null,
    })
    .eq("id", targetAdmin.id);
  if (clearErr) return errorResponse(clearErr.message, 500);

  const { error: logErr } = await callerClient.rpc("log_admin_action", {
    p_action: "admin.mfa_reset",
    p_target_type: "admin_user",
    p_target_id: targetUserId,
    p_before_state: null,
    p_after_state: { factors_cleared: factorsCleared, recovery_cleared: true },
    p_metadata: { admin_id: targetAdmin.id },
  });
  if (logErr) console.error("[admin-auth-actions] audit insert failed:", logErr.message);

  return jsonResponse({ ok: true, factors_cleared: factorsCleared });
});
