import { supabase } from "@/lib/supabase";

export interface AdminEventRow {
  id: string;
  slug: string;
  title: string;
  domain: string;
  status: string;
  mode: string;
  source: string;
  moderation_status: string;
  starts_at: string;
  resolves_at: string;
  submitted_at: string | null;
  created_at: string;
  has_current_prediction: boolean;
  prediction_count: number;
  total_count: number;
}

export interface AdminListEventsParams {
  domain?: string | null;
  status?: string | null;
  moderation_status?: string | null;
  source?: string | null;
  has_prediction?: boolean | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export async function adminListEvents(
  params: AdminListEventsParams,
): Promise<{ rows: AdminEventRow[]; total: number }> {
  const { data, error } = await supabase.rpc("admin_list_events", {
    p_domain: params.domain ?? null,
    p_status: params.status ?? null,
    p_moderation_status: params.moderation_status ?? null,
    p_source: params.source ?? null,
    p_has_prediction: params.has_prediction ?? null,
    p_search: params.search ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AdminEventRow[];
  return { rows, total: rows[0]?.total_count ? Number(rows[0].total_count) : 0 };
}

export interface AdminEventDetail {
  event: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    question: string;
    domain: string;
    status: string;
    mode: string;
    source: string;
    moderation_status: string;
    moderation_reason: string | null;
    moderation_metadata: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
    starts_at: string;
    resolves_at: string;
    submitted_at: string | null;
    submitted_by_fingerprint: string | null;
    submitted_by_user_id: string | null;
    parent_event_id: string | null;
    created_at: string;
    updated_at: string;
  };
  outcomes: Array<{
    id: string;
    external_id: string | null;
    label: string;
    metadata: Record<string, unknown> | null;
  }>;
  current_prediction: {
    id: string;
    event_id: string;
    mode: string;
    ranked_outcomes: Array<Record<string, unknown>>;
    alternates: Array<Record<string, unknown>>;
    consensus_method: string | null;
    consensus_score: number | null;
    agreement_score: number | null;
    model_results: Array<Record<string, unknown>>;
    generated_at: string;
    expires_at: string | null;
    is_current: boolean;
  } | null;
  children: Array<{
    id: string;
    slug: string;
    title: string;
    status: string;
    mode: string;
  }>;
  resolution: {
    event_id: string;
    outcome_rankings: Record<string, unknown>;
    source: string | null;
    resolution_context: string | null;
    resolved_at: string;
  } | null;
  submitter: { id: string; email: string | null } | null;
}

export async function adminGetEventDetail(eventId: string): Promise<AdminEventDetail> {
  const { data, error } = await supabase.rpc("admin_get_event_detail", {
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message);
  return data as AdminEventDetail;
}

export interface AdminEditEventPatch {
  title?: string;
  question?: string;
  description?: string | null;
  starts_at?: string;
  resolves_at?: string;
  metadata?: Record<string, unknown>;
}

export async function adminEditEvent(eventId: string, patch: AdminEditEventPatch): Promise<void> {
  const { error } = await supabase.rpc("admin_edit_event", {
    p_event_id: eventId,
    p_patch: patch,
  });
  if (error) throw new Error(error.message);
}

export async function adminCancelEvent(eventId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("admin_cancel_event", {
    p_event_id: eventId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function adminPinEvent(
  eventId: string,
  date: string,
): Promise<{ ok: boolean; position: number; already_pinned: boolean }> {
  const { data, error } = await supabase.rpc("admin_pin_event", {
    p_event_id: eventId,
    p_date: date,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; position: number; already_pinned: boolean };
}

export async function adminUnpinEvent(eventId: string, date: string): Promise<void> {
  const { error } = await supabase.rpc("admin_unpin_event", {
    p_event_id: eventId,
    p_date: date,
  });
  if (error) throw new Error(error.message);
}
