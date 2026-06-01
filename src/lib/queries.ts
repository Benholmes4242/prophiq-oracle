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
  domain?: DomainId;
  status?: EventStatus | EventStatus[];
  mode?: EventMode;
  source?: EventSource;
  limit?: number;
  /** Sort: 'starts_at_asc' (default, upcoming first) or 'created_at_desc'. */
  order?: "starts_at_asc" | "starts_at_desc" | "created_at_desc";
}

export async function fetchEvents(filter: EventsFilter = {}): Promise<EventRow[]> {
  let q = supabase.from("events").select(EVENT_COLS);
  if (filter.domain) q = q.eq("domain", filter.domain);
  if (filter.mode) q = q.eq("mode", filter.mode);
  if (filter.source) q = q.eq("source", filter.source);
  if (filter.status) {
    if (Array.isArray(filter.status)) q = q.in("status", filter.status);
    else q = q.eq("status", filter.status);
  }
  const order = filter.order ?? "starts_at_asc";
  if (order === "starts_at_asc") q = q.order("starts_at", { ascending: true });
  else if (order === "starts_at_desc") q = q.order("starts_at", { ascending: false });
  else q = q.order("created_at", { ascending: false });
  if (filter.limit) q = q.limit(filter.limit);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EventRow[];
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
