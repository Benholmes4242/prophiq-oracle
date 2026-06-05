import { supabase } from "@/lib/supabase";

export interface CostSummaryRow {
  model: string;
  n_calls: number;
  n_errors: number;
  total_input_tk: number;
  total_output_tk: number;
  total_cost_minor: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  currency: string | null;
}

export interface CostDailyRow {
  day: string;
  model: string;
  n_calls: number;
  total_cost_minor: number;
}

export interface CostRecentRow {
  id: string;
  called_at: string;
  model: string;
  domain: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  est_cost_minor: number | null;
  currency: string | null;
  had_error: boolean;
  error_message: string | null;
  prediction_id: string | null;
  event_id: string | null;
}

export interface CostPricingRow {
  model: string;
  input_per_million_minor: number;
  output_per_million_minor: number;
  currency: string;
  effective_from: string;
  notes: string | null;
}

export async function adminCostSummary(
  sinceIso: string,
  untilIso: string,
  domain?: string | null,
): Promise<CostSummaryRow[]> {
  const { data, error } = await supabase.rpc("admin_cost_summary", {
    p_since: sinceIso,
    p_until: untilIso,
    p_domain: domain ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CostSummaryRow[];
}

export async function adminCostDaily(
  sinceIso: string,
  untilIso: string,
  domain?: string | null,
): Promise<CostDailyRow[]> {
  const { data, error } = await supabase.rpc("admin_cost_daily", {
    p_since: sinceIso,
    p_until: untilIso,
    p_domain: domain ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CostDailyRow[];
}

export async function adminCostRecent(limit = 100): Promise<CostRecentRow[]> {
  const { data, error } = await supabase.rpc("admin_cost_recent", { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as CostRecentRow[];
}

export async function adminCostPricing(): Promise<CostPricingRow[]> {
  const { data, error } = await supabase.rpc("admin_cost_pricing");
  if (error) throw new Error(error.message);
  return (data ?? []) as CostPricingRow[];
}

/** Convert a numeric cost in minor units (cents) to a display string. */
export function formatCostMinor(minor: number | null | undefined, currency = "USD"): string {
  if (minor == null || Number.isNaN(Number(minor))) return "—";
  const major = Number(minor) / 100;
  if (major < 0.01 && major > 0) return `<$0.01 ${currency === "USD" ? "" : currency}`.trim();
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: major < 1 ? 4 : 2,
  }).format(major);
}
