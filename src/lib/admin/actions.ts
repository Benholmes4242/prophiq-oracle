import { supabase } from "@/lib/supabase";

// ---------- DB RPCs ----------

export async function adminGrantPro(args: {
  userId: string;
  tier: "standard" | "pro";
  expiresAt: string | null;
  reason: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("admin_grant_pro", {
    p_user_id: args.userId,
    p_tier: args.tier,
    p_expires_at: args.expiresAt,
    p_reason: args.reason,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function adminRevokePro(overrideId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("admin_revoke_pro", {
    p_override_id: overrideId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function adminAdjustQuota(args: {
  userId: string;
  extra: number;
  reason: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("admin_adjust_quota", {
    p_user_id: args.userId,
    p_extra: args.extra,
    p_reason: args.reason,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function adminSuspendUser(userId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("admin_suspend_user", {
    p_user_id: userId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function adminUnsuspendUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_unsuspend_user", { p_user_id: userId });
  if (error) throw new Error(error.message);
}

export async function adminApproveQuestion(eventId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_approve_question", { p_event_id: eventId });
  if (error) throw new Error(error.message);
  // Dispatch generation (fire-and-forget; UI awaits but tolerates failure)
  await supabase.functions.invoke("generate-prediction", { body: { event_id: eventId } });
}

export async function adminRejectQuestion(eventId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("admin_reject_question", {
    p_event_id: eventId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function adminForceDeleteUser(userId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("admin_force_delete_user", {
    p_user_id: userId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

// ---------- Edge function invocations ----------

export async function adminStripeForceCancel(args: {
  userId: string;
  subscriptionId: string;
  reason: string;
}): Promise<void> {
  const { error } = await supabase.functions.invoke("admin-stripe-actions", {
    body: {
      action: "force_cancel",
      user_id: args.userId,
      subscription_id: args.subscriptionId,
      reason: args.reason,
    },
  });
  if (error) throw new Error(error.message);
}

export async function adminStripeRefund(args: {
  userId: string;
  chargeId: string;
  amountMinor?: number;
  reason: string;
}): Promise<void> {
  const { error } = await supabase.functions.invoke("admin-stripe-actions", {
    body: {
      action: "refund",
      user_id: args.userId,
      charge_id: args.chargeId,
      amount_minor: args.amountMinor,
      reason: args.reason,
    },
  });
  if (error) throw new Error(error.message);
}

export async function adminResendOtp(userId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("admin-auth-actions", {
    body: { action: "resend_otp", user_id: userId },
  });
  if (error) throw new Error(error.message);
}
