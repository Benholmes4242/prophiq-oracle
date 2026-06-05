import { supabase } from "@/lib/supabase";

export type AdminRole = "super_admin" | "admin" | "support" | "read_only";

export interface AdminUserRow {
  user_id: string;
  email: string;
  signup_date: string;
  last_active_at: string | null;
  plan_tier: string;
  subscription_status: string;
  trial_ends_at: string | null;
  lifetime_questions: number;
  questions_this_month: number;
  total_count: number;
}

export interface AdminUserListParams {
  search?: string | null;
  plan?: string | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}

export async function adminListUsers(
  params: AdminUserListParams,
): Promise<{ rows: AdminUserRow[]; total: number }> {
  const { data, error } = await supabase.rpc("admin_list_users", {
    p_search: params.search ?? null,
    p_plan_filter: params.plan ?? null,
    p_status_filter: params.status ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AdminUserRow[];
  return { rows, total: rows[0]?.total_count ? Number(rows[0].total_count) : 0 };
}

export interface AdminUserDetail {
  user: {
    id: string;
    email: string | null;
    created_at: string;
    last_sign_in_at: string | null;
    email_confirmed_at: string | null;
    phone: string | null;
    metadata: Record<string, unknown> | null;
  };
  subscription: {
    id: string;
    status: string;
    stripe_subscription_id: string;
    stripe_customer_id: string;
    current_period_start: string;
    current_period_end: string;
    cancel_at_period_end: boolean;
    trial_end: string | null;
    plan_tier: string;
    plan_cadence: string;
    amount_minor_units: number;
    currency: string;
    daily_forecast_cap: number;
    display_name: string;
  } | null;
  usage_today: number;
  usage_this_month: number;
  usage_lifetime: number;
  usage_last_7_days: { date: string; count: number }[];
  recent_questions: {
    event_id: string;
    slug: string;
    title: string;
    domain: string;
    submitted_at: string | null;
    starts_at: string;
    status: string;
  }[];
  is_admin: boolean;
  admin_role: AdminRole | null;
  admin_meta: {
    mfa_enforced: boolean;
    created_at: string;
    notes: string | null;
  } | null;
  recent_audit_log: {
    action: string;
    admin_email: string;
    created_at: string;
    metadata: Record<string, unknown>;
  }[];
}

export async function adminGetUserDetail(
  userId: string,
): Promise<AdminUserDetail> {
  const { data, error } = await supabase.rpc("admin_get_user_detail", {
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  return data as AdminUserDetail;
}

export async function getAdminRole(): Promise<AdminRole | null> {
  const { data, error } = await supabase.rpc("get_admin_role");
  if (error) return null;
  return (data as AdminRole | null) ?? null;
}

export async function checkIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) return false;
  return Boolean(data);
}
