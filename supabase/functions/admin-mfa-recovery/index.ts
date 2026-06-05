// POST /functions/v1/admin-mfa-recovery
//
// Two operations for the admin's own MFA factor:
//
//   { action: "generate" }  -> mint a recovery code (returned ONCE),
//                              store sha256 hash in admin_users.recovery_code_hash.
//   { action: "consume", code } -> verify the code against the stored hash,
//                              clear all the admin's TOTP factors so they can
//                              re-enroll, and clear the stored hash.
//
// The caller is always the admin themselves (acting on their own
// admin_users row). Both operations require the caller to be an admin;
// no specific role beyond that.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";

interface Body {
  action?: "generate" | "consume";
  code?: string;
}

function readEnv(name: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get(name);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomCode(): string {
  // 20 base32-ish chars, grouped 5-5-5-5, e.g. "K7QF3-XPR2A-9DLMS-4UV7H".
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 5 === 4 && i !== bytes.length - 1) out += "-";
  }
  return out;
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: Body;
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body"); }

  const action = body.action;
  if (action !== "generate" && action !== "consume") {
    return errorResponse("action must be 'generate' or 'consume'");
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

  // Identify caller and confirm they are an admin.
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return errorResponse("Unauthorized", 401);
  const callerUserId = userData.user.id;

  const { data: adminRow, error: adminErr } = await service
    .from("admin_users")
    .select("id, recovery_code_hash")
    .eq("user_id", callerUserId)
    .is("revoked_at", null)
    .maybeSingle();
  if (adminErr) return errorResponse(adminErr.message, 500);
  if (!adminRow) return errorResponse("Admin access required", 403);

  if (action === "generate") {
    const code = randomCode();
    const hash = await sha256Hex(code);
    const { error: updErr } = await service
      .from("admin_users")
      .update({ recovery_code_hash: hash, recovery_code_set_at: new Date().toISOString() })
      .eq("id", adminRow.id);
    if (updErr) return errorResponse(updErr.message, 500);

    // Audit (as caller).
    const { error: logErr } = await callerClient.rpc("log_admin_action", {
      p_action: "admin.mfa_recovery_generate",
      p_target_type: "admin_user",
      p_target_id: callerUserId,
      p_before_state: null,
      p_after_state: { recovery_code_set_at: new Date().toISOString() },
      p_metadata: {},
    });
    if (logErr) console.error("[admin-mfa-recovery] audit failed:", logErr.message);

    return jsonResponse({ ok: true, code });
  }

  // consume
  const submitted = (body.code ?? "").trim().toUpperCase();
  if (!submitted) return errorResponse("code required");
  if (!adminRow.recovery_code_hash) {
    return errorResponse("No recovery code set", 422);
  }
  const submittedHash = await sha256Hex(submitted);
  if (submittedHash !== adminRow.recovery_code_hash) {
    // Notify on failed recovery use.
    await service.rpc("raise_admin_notification", {
      p_severity: "warning",
      p_category: "security",
      p_title: "Failed MFA recovery attempt",
      p_body: `Failed recovery code submission for admin ${callerUserId}.`,
      p_source: "auth",
      p_target_url: "/admin/audit",
      p_dedup_key: `security:mfa_recovery_fail:${callerUserId}`,
      p_metadata: {},
    }).catch(() => undefined);
    return errorResponse("Invalid recovery code", 401);
  }

  // Clear the caller's TOTP factors so they re-enrol, and clear the stored hash.
  const { data: factors } = await service.auth.admin.mfa.listFactors({ userId: callerUserId });
  for (const f of factors?.factors ?? []) {
    if (f.factor_type === "totp") {
      await service.auth.admin.mfa.deleteFactor({ userId: callerUserId, id: f.id })
        .catch((e) => console.error("[admin-mfa-recovery] deleteFactor:", e));
    }
  }
  await service
    .from("admin_users")
    .update({ recovery_code_hash: null, recovery_code_set_at: null, mfa_last_verified_at: null })
    .eq("id", adminRow.id);

  const { error: logErr } = await callerClient.rpc("log_admin_action", {
    p_action: "admin.mfa_recovery_consume",
    p_target_type: "admin_user",
    p_target_id: callerUserId,
    p_before_state: { had_recovery: true },
    p_after_state: { had_recovery: false, factors_cleared: true },
    p_metadata: {},
  });
  if (logErr) console.error("[admin-mfa-recovery] audit failed:", logErr.message);

  return jsonResponse({ ok: true, factors_cleared: true });
});
