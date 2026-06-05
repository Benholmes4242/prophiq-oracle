import { supabase } from "@/lib/supabase";

export interface RevenueMetrics {
  mrr_minor: number;
  currency: string | null;
  active_count: number;
  trialing_count: number;
  past_due_count: number;
  canceled_in_period: number;
  new_in_period: number;
  trial_to_paid: { trials_started: number; converted: number };
  period_start: string;
  period_end: string;
}

export interface MrrHistoryRow {
  month_start: string;
  mrr_minor: number;
  active_count: number;
}

export interface PlanDistributionRow {
  tier: string;
  cadence: string;
  sub_count: number;
}

export interface TopCustomerRow {
  user_id: string;
  email: string;
  tier: string;
  cadence: string;
  signup_date: string;
  est_lifetime_minor: number;
  status: string;
}

export interface StripeSyncResult {
  ok: boolean;
  as_of: string;
  period_start: string;
  period_end: string;
  refunds: { total_minor: number; count: number; currency: string | null };
  invoices: {
    open: number;
    paid: number;
    uncollectible: number;
    recovery_rate: number | null;
  };
}

export async function adminRevenueMetrics(
  periodStart: string,
  periodEnd: string,
): Promise<RevenueMetrics> {
  const { data, error } = await supabase.rpc("admin_revenue_metrics", {
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    mrr_minor: Number(raw.mrr_minor ?? 0),
    currency: (raw.currency as string | null) ?? null,
    active_count: Number(raw.active_count ?? 0),
    trialing_count: Number(raw.trialing_count ?? 0),
    past_due_count: Number(raw.past_due_count ?? 0),
    canceled_in_period: Number(raw.canceled_in_period ?? 0),
    new_in_period: Number(raw.new_in_period ?? 0),
    trial_to_paid: {
      trials_started: Number(
        (raw.trial_to_paid as { trials_started?: number } | undefined)?.trials_started ?? 0,
      ),
      converted: Number(
        (raw.trial_to_paid as { converted?: number } | undefined)?.converted ?? 0,
      ),
    },
    period_start: (raw.period_start as string) ?? periodStart,
    period_end: (raw.period_end as string) ?? periodEnd,
  };
}

export async function adminMrrHistory(months = 12): Promise<MrrHistoryRow[]> {
  const { data, error } = await supabase.rpc("admin_mrr_history", { p_months: months });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { month_start: string; mrr_minor: number | string; active_count: number | string }) => ({
    month_start: r.month_start,
    mrr_minor: Number(r.mrr_minor),
    active_count: Number(r.active_count),
  }));
}

export async function adminPlanDistribution(): Promise<PlanDistributionRow[]> {
  const { data, error } = await supabase.rpc("admin_plan_distribution");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { tier: string; cadence: string; sub_count: number | string }) => ({
    tier: r.tier,
    cadence: r.cadence,
    sub_count: Number(r.sub_count),
  }));
}

export async function adminTopCustomers(limit = 20): Promise<TopCustomerRow[]> {
  const { data, error } = await supabase.rpc("admin_top_customers", { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: TopCustomerRow & { est_lifetime_minor: number | string }) => ({
    ...r,
    est_lifetime_minor: Number(r.est_lifetime_minor),
  }));
}

export async function adminRevenueSync(
  periodStart: string,
  periodEnd: string,
): Promise<StripeSyncResult> {
  const { data, error } = await supabase.functions.invoke("admin-revenue-sync", {
    body: { period_start: periodStart, period_end: periodEnd },
  });
  if (error) throw new Error(error.message ?? "Stripe sync failed");
  return data as StripeSyncResult;
}

/** Format minor units (cents) as a localized money string. */
export function formatMinor(minor: number, currency: string | null): string {
  const ccy = (currency ?? "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: ccy,
      maximumFractionDigits: 0,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(0)} ${ccy}`;
  }
}
