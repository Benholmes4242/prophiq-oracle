// Public read queries against Supabase. RLS allows anon SELECT on these
// tables — no auth required.

import { supabase } from "./supabase";
import type {
  ConfidenceTier,
  DataTier,
  DomainId,
  EventMode,
  EventRow,
  EventSource,
  EventStatus,
  EventWithPrediction,
  PredictionRow,
} from "./types";

const EVENT_COLS =
  "id, domain, slug, title, description, question, starts_at, resolves_at, status, mode, source, metadata, created_at";

export interface EventsFilter {
  domain?: DomainId | DomainId[];
  status?: EventStatus | EventStatus[];
  mode?: EventMode;
  source?: EventSource;
  limit?: number;
  /** Sort: 'starts_at_asc' (default, upcoming first) or 'created_at_desc'. */
  order?: "starts_at_asc" | "starts_at_desc" | "created_at_desc";
  /** Filter to events whose starts_at is strictly before this ISO timestamp. */
  startedBefore?: string;
}

function applyEventFilters(q: any, filter: EventsFilter): any {
  let out = q;
  // Fix 3: hide sub-question child events from every public feed. They are
  // surfaced underneath their parent via fetchEventFamilyBySlug. Leaving
  // them in the main feed produced standalone rows like "Will the print
  // beat consensus?" / "Will the winning margin be more than 10 points?".
  out = out.is("parent_event_id", null);
  if (filter.domain) {
    if (Array.isArray(filter.domain)) out = out.in("domain", filter.domain);
    else out = out.eq("domain", filter.domain);
  }
  if (filter.mode === "odds") out = out.in("mode", ["odds", "both"]);
  else if (filter.mode === "prediction") out = out.in("mode", ["prediction", "both"]);
  if (filter.source) out = out.eq("source", filter.source);
  if (filter.status) {
    if (Array.isArray(filter.status)) out = out.in("status", filter.status);
    else out = out.eq("status", filter.status);
  }
  if (filter.startedBefore) out = out.lt("starts_at", filter.startedBefore);
  const order = filter.order ?? "starts_at_asc";
  if (order === "starts_at_asc") out = out.order("starts_at", { ascending: true });
  else if (order === "starts_at_desc") out = out.order("starts_at", { ascending: false });
  else out = out.order("created_at", { ascending: false });
  if (filter.limit) out = out.limit(filter.limit);
  return out;
}

export async function fetchEvents(filter: EventsFilter = {}): Promise<EventRow[]> {
  const q = applyEventFilters(supabase.from("events").select(EVENT_COLS), filter);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

export async function fetchEventsWithPredictions(
  filter: EventsFilter = {},
  mode: "prediction" | "odds" = "prediction",
): Promise<EventWithPrediction[]> {
  const q = applyEventFilters(
    supabase
      .from("events")
      .select(`${EVENT_COLS}, predictions:v_predictions_public!left(*)`)
      .eq("predictions.is_current", true)
      .eq("predictions.mode", mode),
    filter,
  );
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<EventRow & { predictions: PredictionRow[] }>;
  return rows.map((r) => {
    const { predictions, ...event } = r;
    return { event: event as EventRow, prediction: predictions?.[0] ?? null };
  });
}

export async function fetchEventBySlug(slug: string): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_COLS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return (data as EventRow | null) ?? null;
}

export async function fetchCurrentPrediction(
  eventId: string,
  mode: "prediction" | "odds" = "prediction",
): Promise<PredictionRow | null> {
  const { data, error } = await supabase
    .from("v_predictions_public")
    .select("*")
    .eq("event_id", eventId)
    .eq("mode", mode)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw error;
  return (data as PredictionRow | null) ?? null;
}

export async function fetchRecentPicks(limit = 6): Promise<EventWithPrediction[]> {
  const { data, error } = await supabase
    .from("v_predictions_public")
    .select(`*, event:events!inner(${EVENT_COLS})`)
    .eq("is_current", true)
    // Fix 3: hide sub-question predictions from the recent-picks rail.
    .is("event.parent_event_id", null)
    // Trust-layer gate: never feature a low_data forecast on home rails.
    // Legacy rows without a tier are still allowed through.
    .or("data_tier.is.null,data_tier.in.(feed_backed,research_grounded)")
    // Outcome-quality gate: never surface placeholder top outcomes
    // ("Field", "Any other runner wins", "horse 2 wins", etc.).
    // Legacy rows where the column is null are still allowed through.
    .or("is_placeholder_outcome.is.null,is_placeholder_outcome.eq.false")
    .order("generated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as Array<PredictionRow & { event: EventRow }>;
  return rows.map((r) => {
    const { event, ...prediction } = r;
    return { event, prediction: prediction as PredictionRow };
  });
}

export interface DomainSummary {
  domain: DomainId;
  upcoming_count: number;
  resolved_count: number;
  scored_count: number;
  top_pick_wins: number;
}

export async function fetchDomainSummaries(): Promise<DomainSummary[]> {
  const { data, error } = await supabase.from("v_domain_summary").select("*");
  if (error) throw error;
  return (data ?? []) as DomainSummary[];
}

export interface AccuracyRow {
  id: string;
  prediction_id: string;
  event_id: string;
  domain: DomainId;
  mode: "prediction" | "odds";
  pick_results: unknown;
  top_pick_correct: boolean | null;
  picks_in_top_3: number | null;
  picks_in_top_5: number | null;
  picks_in_top_10: number | null;
  best_pick_actual_rank: number | null;
  average_predicted_rank: number | null;
  average_actual_rank: number | null;
  accuracy_grade: "excellent" | "good" | "mixed" | "poor" | null;
  scored_at: string;
  event: Pick<EventRow, "id" | "slug" | "title" | "domain" | "starts_at" | "resolves_at"> | null;
}

export async function fetchDomainAccuracy(
  domain: DomainId,
  limit = 50,
): Promise<AccuracyRow[]> {
  const { data, error } = await supabase
    .from("prediction_accuracy")
    .select(
      "id, prediction_id, event_id, domain, mode, pick_results, top_pick_correct, picks_in_top_3, picks_in_top_5, picks_in_top_10, best_pick_actual_rank, average_predicted_rank, average_actual_rank, accuracy_grade, scored_at, event:events!inner(id, slug, title, domain, starts_at, resolves_at)",
    )
    .eq("domain", domain)
    .order("scored_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as AccuracyRow[];
}

// ============================================================
// Homepage picks (RPC) — 1 marquee + up to 3 by agreement.
// ============================================================

export interface HomepagePick {
  event_id: string;
  domain: DomainId;
  slug: string;
  title: string;
  question: string;
  starts_at: string;
  top_pick_label: string | null;
  top_pick_pct: number | null;
  confidence: ConfidenceTier;
  data_tier: DataTier | null;
  reasoning_excerpt: string | null;
  is_marquee: boolean;
}

export async function fetchHomepagePicks(): Promise<HomepagePick[]> {
  const { data, error } = await supabase.rpc("get_homepage_picks");
  if (error) throw error;
  return (data ?? []) as HomepagePick[];
}

// ============================================================
// Scored yesterday — most recent resolved events with a top pick.
// ============================================================

export interface ScoredPick {
  event_id: string;
  event_title: string;
  domain: DomainId;
  slug: string;
  pick_label: string;
  correct: boolean;
  scored_at: string;
}

export async function fetchScoredYesterday(limit = 6): Promise<ScoredPick[]> {
  return fetchScoredRecent({ sinceMs: 36 * 60 * 60 * 1000, limit });
}

export async function fetchScoredRecent(opts: {
  sinceMs?: number;
  limit?: number;
  domain?: DomainId;
}): Promise<ScoredPick[]> {
  const sinceMs = opts.sinceMs ?? 7 * 24 * 60 * 60 * 1000;
  const limit = opts.limit ?? 6;
  const since = new Date(Date.now() - sinceMs).toISOString();
  let q = supabase
    .from("prediction_accuracy")
    .select(
      "event_id, top_pick_correct, scored_at, pick_results, event:events!inner(id, slug, title, domain)",
    )
    .gte("scored_at", since)
    .order("scored_at", { ascending: false })
    .limit(limit);
  if (opts.domain) q = q.eq("domain", opts.domain);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{
    event_id: string;
    top_pick_correct: boolean | null;
    scored_at: string;
    pick_results: unknown;
    event: { id: string; slug: string; title: string; domain: DomainId } | null;
  }>;
  return rows
    .filter((r) => r.event != null)
    .map((r) => {
      const first =
        Array.isArray(r.pick_results) && r.pick_results.length > 0
          ? (r.pick_results[0] as { label?: string; outcome_label?: string })
          : null;
      const pickLabel =
        (first?.label ?? first?.outcome_label ?? "—") as string;
      return {
        event_id: r.event!.id,
        event_title: r.event!.title,
        domain: r.event!.domain,
        slug: r.event!.slug,
        pick_label: pickLabel,
        correct: r.top_pick_correct === true,
        scored_at: r.scored_at,
      };
    });
}

// ============================================================
// Receipts page RPCs.
// ============================================================

export interface ReceiptsStats {
  events_scored: number;
  top_pick_hit_rate: number;
  top_three_hit_rate: number;
  days_running: number;
  last_30d_accuracy: Array<{ date: string; accuracy: number }>;
}

export async function fetchReceiptsStats(): Promise<ReceiptsStats> {
  const { data, error } = await supabase.rpc("get_receipts_stats");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    events_scored: Number(row?.events_scored ?? 0),
    top_pick_hit_rate: Number(row?.top_pick_hit_rate ?? 0),
    top_three_hit_rate: Number(row?.top_three_hit_rate ?? 0),
    days_running: Number(row?.days_running ?? 0),
    last_30d_accuracy: Array.isArray(row?.last_30d_accuracy)
      ? row.last_30d_accuracy
      : [],
  };
}

export interface RecentResolved {
  event_id: string;
  domain: DomainId;
  slug: string;
  title: string;
  resolved_at: string;
  top_pick_label: string | null;
  top_pick_pct: number | null;
  actual_outcome: string | null;
  correct: boolean;
  confidence: ConfidenceTier;
  data_tier: DataTier | null;
}

export async function fetchRecentResolved(limit = 10): Promise<RecentResolved[]> {
  const { data, error } = await supabase.rpc("get_recent_resolved", { _limit: limit });
  if (error) throw error;
  return (data ?? []) as RecentResolved[];
}

export interface NotableCall {
  event_id: string;
  domain: DomainId;
  slug: string;
  title: string;
  resolved_at: string;
  top_pick_label: string | null;
  top_pick_pct: number | null;
  actual_outcome: string | null;
  correct: boolean;
  drama_score: number;
}

export async function fetchNotableCalls(): Promise<NotableCall[]> {
  const { data, error } = await supabase.rpc("get_notable_calls");
  if (error) throw error;
  return (data ?? []) as NotableCall[];
}

// ============================================================
// Event resolution lookup (for the resolved banner).
// ============================================================

export interface EventResolutionSummary {
  actual_outcome: string | null;
  top_pick_correct: boolean | null;
}

export async function fetchEventResolution(
  eventId: string,
): Promise<EventResolutionSummary | null> {
  const { data: pa } = await supabase
    .from("prediction_accuracy")
    .select("top_pick_correct, pick_results")
    .eq("event_id", eventId)
    .eq("mode", "prediction")
    .maybeSingle();
  const { data: er } = await supabase
    .from("event_resolutions")
    .select("outcome_rankings")
    .eq("event_id", eventId)
    .maybeSingle();
  if (!pa && !er) return null;
  let actual: string | null = null;
  const rankings = (er?.outcome_rankings ?? []) as Array<{
    outcome_id: string;
    rank: number;
  }>;
  const winner = rankings.find((r) => r.rank === 1) ?? rankings[0];
  if (winner?.outcome_id) {
    const { data: outcome } = await supabase
      .from("event_outcomes")
      .select("label")
      .eq("id", winner.outcome_id)
      .maybeSingle();
    actual = (outcome?.label as string | undefined) ?? null;
  }
  return {
    actual_outcome: actual,
    top_pick_correct:
      (pa?.top_pick_correct as boolean | null | undefined) ?? null,
  };
}

// ============================================================
// Event family (parent + children) — Brief FF v2 Phase C.
// Backed by RPC public.get_event_with_children(p_slug).
// ============================================================

export interface EventFamilyMember {
  event: EventRow;
  prediction: PredictionRow | null;
}

export interface EventFamily {
  resolved_from_child: boolean;
  parent: EventFamilyMember;
  children: EventFamilyMember[];
}

export async function fetchEventFamilyBySlug(
  slug: string,
): Promise<EventFamily | null> {
  const { data, error } = await supabase.rpc("get_event_with_children", {
    p_slug: slug,
  });
  if (error) throw error;
  if (!data) return null;
  return data as EventFamily;
}
