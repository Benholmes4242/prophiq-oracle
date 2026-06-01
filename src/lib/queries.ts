// Public read queries against Supabase. RLS allows anon SELECT on these
// tables — no auth required.

import { supabase } from "./supabase";
import type {
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
  if (filter.domain) {
    if (Array.isArray(filter.domain)) out = out.in("domain", filter.domain);
    else out = out.eq("domain", filter.domain);
  }
  // Mode filter: events with mode='both' support either prediction or odds,
  // so include them when the user picks a specific mode.
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

/**
 * Events + their current prediction (left-joined). Used by the predictions
 * feed so each card can show its top pick without a per-card round trip.
 */
export async function fetchEventsWithPredictions(
  filter: EventsFilter = {},
  mode: "prediction" | "odds" = "prediction",
): Promise<EventWithPrediction[]> {
  const q = applyEventFilters(
    supabase
      .from("events")
      .select(`${EVENT_COLS}, predictions!left(*)`)
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
    .from("predictions")
    .select("*")
    .eq("event_id", eventId)
    .eq("mode", mode)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw error;
  return (data as PredictionRow | null) ?? null;
}

/**
 * Recent picks rail: most recently generated current predictions joined to
 * their events. Limited and ordered by prediction.generated_at desc.
 */
export async function fetchRecentPicks(limit = 6): Promise<EventWithPrediction[]> {
  const { data, error } = await supabase
    .from("predictions")
    .select(`*, event:events!inner(${EVENT_COLS})`)
    .eq("is_current", true)
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

