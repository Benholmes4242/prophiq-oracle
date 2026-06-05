import { supabase } from "@/lib/supabase";

export interface CronOverviewRow {
  job_name: string;
  schedule: string;
  paused: boolean;
  last_ran_at: string | null;
  last_status: string | null;
  last_duration_ms: number | null;
  last_items_processed: number | null;
  success_rate_30d: number | null;
  avg_duration_ms_30d: number | null;
  run_count_30d: number;
}

export interface CronRunRow {
  id: string;
  ran_at: string;
  status: string;
  duration_ms: number | null;
  items_processed: number | null;
  detail: Record<string, unknown>;
  error_message: string | null;
}

export async function adminCronOverview(): Promise<CronOverviewRow[]> {
  const { data, error } = await supabase.rpc("admin_cron_overview");
  if (error) throw new Error(error.message);
  return (data ?? []) as CronOverviewRow[];
}

export async function adminCronRuns(jobName: string, limit = 50): Promise<CronRunRow[]> {
  const { data, error } = await supabase.rpc("admin_cron_runs", {
    p_job_name: jobName,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CronRunRow[];
}

const SQL_REFRESH_JOBS = new Set([
  "refresh-calibration-buckets",
  "refresh-calibration-curves",
  "refresh-homepage-picks-daily",
]);

const EDGE_JOBS: Record<string, string> = {
  prophiq_discover_events: "discover-events",
  prophiq_generate_predictions: "generate-prediction",
  prophiq_score_predictions: "score-prediction",
  prophiq_health_check: "health-check",
  prophiq_notification_digest: "notification-digest",
};

/**
 * Manual trigger. SQL refresh jobs run via the SECURITY DEFINER RPC.
 * Edge-function jobs are invoked from the browser with the admin's bearer
 * token. Both paths produce a cron_run_metrics row (the SQL RPC via its
 * wrapper, the edge fn via its self-report).
 */
export async function adminRunCronJob(jobName: string): Promise<void> {
  if (SQL_REFRESH_JOBS.has(jobName)) {
    const { error } = await supabase.rpc("admin_run_cron_job", { p_job_name: jobName });
    if (error) throw new Error(error.message);
    return;
  }
  const fn = EDGE_JOBS[jobName];
  if (!fn) throw new Error(`Unknown job: ${jobName}`);
  if (jobName === "prophiq_generate_predictions") {
    // Trigger the SQL fan-out (which dispatches per-event). We invoke the RPC
    // directly so the SQL wrapper runs and writes its summary row.
    const { error } = await supabase.rpc("cron_generate_pending_predictions", { p_limit: 50 });
    if (error) throw new Error(error.message);
    return;
  }
  if (jobName === "prophiq_score_predictions") {
    const { error } = await supabase.rpc("cron_score_pending_events", { p_limit: 100 });
    if (error) throw new Error(error.message);
    return;
  }
  // Single-call edge functions (discover/health/digest): invoke directly.
  const { error } = await supabase.functions.invoke(fn, {
    body: { source: "cron", manual: true },
  });
  if (error) throw new Error(error.message);
}

export async function adminSetCronActive(jobName: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc("admin_set_cron_active", {
    p_job_name: jobName,
    p_active: active,
  });
  if (error) throw new Error(error.message);
}

export function humanizeCron(expr: string): string {
  const presets: Record<string, string> = {
    "0 */4 * * *": "Every 4 hours",
    "5 * * * *": "Hourly at :05",
    "15 * * * *": "Hourly at :15",
    "*/5 * * * *": "Every 5 minutes",
    "*/30 * * * *": "Every 30 minutes",
    "0 */6 * * *": "Every 6 hours",
    "0 2 * * 0": "Weekly, Sun 02:00 UTC",
    "0 6 * * *": "Daily at 06:00 UTC",
  };
  return presets[expr] ?? expr;
}
