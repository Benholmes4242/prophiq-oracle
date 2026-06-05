import { supabase } from "@/lib/supabase";

export interface CalibrationOverviewRow {
  domain: string;
  n_resolved: number;
  top1_accuracy: number | null;
  top3_accuracy: number | null;
  avg_brier: number | null;
  avg_top_prob: number | null;
  last_resolved_at: string | null;
}

export interface PerLlmAccuracyRow {
  model: string;
  n_resolved: number;
  n_with_pick: number;
  n_errors: number;
  top1_accuracy: number | null;
}

export interface PendingResolutionRow {
  event_id: string;
  slug: string;
  title: string;
  domain: string;
  resolves_at: string;
  has_current_prediction: boolean;
}

export interface RecentResolutionRow {
  event_id: string;
  slug: string;
  title: string;
  domain: string;
  resolved_at: string;
  source: string | null;
  winning_outcome_id: string | null;
  winning_label: string | null;
  top_pick_correct: boolean | null;
}

export interface EventOutcomeRow {
  outcome_id: string;
  label: string;
  external_id: string | null;
}

export interface ResolveResult {
  ok: boolean;
  event_id: string;
  winning_outcome_id: string;
  winning_outcome_label: string | null;
  top_pick_correct: boolean | null;
  audit_id: string | null;
}

export async function adminCalibrationOverview(
  domain?: string | null,
  since?: string | null,
): Promise<CalibrationOverviewRow[]> {
  const { data, error } = await supabase.rpc("admin_calibration_overview", {
    p_domain: domain ?? null,
    p_since: since ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CalibrationOverviewRow[];
}

export async function adminPerLlmAccuracy(
  domain?: string | null,
  since?: string | null,
): Promise<PerLlmAccuracyRow[]> {
  const { data, error } = await supabase.rpc("admin_per_llm_accuracy", {
    p_domain: domain ?? null,
    p_since: since ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as PerLlmAccuracyRow[];
}

export async function adminPendingResolutions(
  limit = 50,
): Promise<PendingResolutionRow[]> {
  const { data, error } = await supabase.rpc("admin_pending_resolutions", {
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as PendingResolutionRow[];
}

export async function adminRecentResolutions(
  limit = 25,
): Promise<RecentResolutionRow[]> {
  const { data, error } = await supabase.rpc("admin_recent_resolutions", {
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as RecentResolutionRow[];
}

export async function adminEventOutcomes(
  eventId: string,
): Promise<EventOutcomeRow[]> {
  const { data, error } = await supabase.rpc("admin_event_outcomes", {
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as EventOutcomeRow[];
}

export async function adminResolvePrediction(
  eventId: string,
  winningOutcomeId: string,
  context?: string | null,
): Promise<ResolveResult> {
  const { data, error } = await supabase.rpc("admin_resolve_prediction", {
    p_event_id: eventId,
    p_winning_outcome_id: winningOutcomeId,
    p_source: "admin_manual",
    p_resolution_context: context ?? null,
  });
  if (error) throw new Error(error.message);
  return data as ResolveResult;
}
