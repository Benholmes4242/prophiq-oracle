// POST /functions/v1/admin-auth-actions
//
// Admin-initiated Supabase Auth admin operations. Currently:
//   * resend_otp: send the target user a fresh sign-in OTP email
//
// Authorization follows the dual-client pattern from admin-stripe-actions:
// caller-context client checks admin_require_role(); service-role client
// performs the privileged Auth admin call and writes the audit row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";

interface Body {
  action?: "resend_otp";
  user_id?: string;
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
  if (action !== "resend_otp") return errorResponse("action must be 'resend_otp'");
  if (!userId) return errorResponse("user_id required");

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

  // Authorize as caller. resend_otp is permitted for super_admin/admin/support.
  const { error: roleErr } = await callerClient.rpc("admin_require_role", {
    p_roles: ["super_admin", "admin", "support"],
  });
  if (roleErr) return errorResponse(roleErr.message ?? "Forbidden", 403);

  // Resolve target user's email via the admin API.
  const { data: targetData, error: getUserErr } = await service.auth.admin.getUserById(userId);
  if (getUserErr || !targetData?.user?.email) {
    return errorResponse("Target user not found or has no email", 404);
  }
  const email = targetData.user.email;

  // Use signInWithOtp from the service client. shouldCreateUser=false so we
  // never create a phantom account from a misclick.
  const { error: otpErr } = await service.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (otpErr) {
    console.error("[admin-auth-actions] OTP send failed:", otpErr.message);
    return errorResponse(otpErr.message, 500);
  }

  // Audit as caller.
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
});
