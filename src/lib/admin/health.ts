import { supabase } from "@/lib/supabase";

export type HealthStatus = "ok" | "degraded" | "down" | "skipped";

export interface HealthOverviewRow {
  key: string;
  label: string;
  category: "llm" | "research" | "structured_data" | "infra" | "payments";
  critical: boolean;
  enabled: boolean;
  expected_latency_ms: number | null;
  current_status: HealthStatus;
  last_checked_at: string | null;
  last_detail: string | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  success_rate: number;
  run_count: number;
}

export interface HealthFailureRow {
  check_key: string;
  label: string;
  status: HealthStatus;
  latency_ms: number | null;
  detail: string | null;
  checked_at: string;
}

export interface ForecastVolumeRow {
  day: string;
  prediction_count: number;
  perplexity_tokens: number;
}

export interface AdminDashboardSummary {
  signups_today: number;
  signups_7d: number;
  active_subscriptions: number;
  trialing: number;
  questions_today: number;
  mrr_minor_units: number;
  mrr_currency: string | null;
  health: { down: number; degraded: number; ok: number };
  unresolved_critical: number;
}

export async function adminHealthOverview(windowHours = 168): Promise<HealthOverviewRow[]> {
  const { data, error } = await supabase.rpc("admin_health_overview", { p_window_hours: windowHours });
  if (error) throw new Error(error.message);
  return (data ?? []) as HealthOverviewRow[];
}

export async function adminHealthFailures(limit = 50): Promise<HealthFailureRow[]> {
  const { data, error } = await supabase.rpc("admin_health_failures", { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as HealthFailureRow[];
}

export async function adminForecastVolume(days = 7): Promise<ForecastVolumeRow[]> {
  const { data, error } = await supabase.rpc("admin_forecast_volume", { p_days: days });
  if (error) throw new Error(error.message);
  return (data ?? []) as ForecastVolumeRow[];
}

export async function adminDashboardSummary(): Promise<AdminDashboardSummary> {
  const { data, error } = await supabase.rpc("admin_dashboard_summary");
  if (error) throw new Error(error.message);
  return data as AdminDashboardSummary;
}

export async function triggerHealthRetry(key: string): Promise<void> {
  const { error } = await supabase.functions.invoke("health-check", { body: { keys: [key] } });
  if (error) throw new Error(error.message);
  // Audit trail. Non-fatal if it errors.
  await supabase.rpc("log_admin_action", {
    p_action: "health_manual_retry",
    p_target_type: "health_check",
    p_target_id: null,
    p_before_state: null,
    p_after_state: null,
    p_metadata: { key },
  });
}
