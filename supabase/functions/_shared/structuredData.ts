// Universal structured-data type, cache helpers, prompt formatter.
// One table (event_structured_data) backs all domains; the per-domain
// adapter renders its own summary_lines, and this module renders the block
// verbatim.

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export interface StructuredData {
  source: string;                       // "api-sports-football-v3", "fred", "polling-aggregator", "tmdb"
  source_version: string;
  fetched_at: string;                   // ISO
  payload: Record<string, unknown>;     // domain-specific shape (full data, for cache + lineage)
  summary_lines: string[];              // already-formatted lines for prompt injection
}

const CACHE_TTL_MS = 60 * 60 * 1000;   // 1 hour

export async function loadCachedStructuredData(
  supabase: SupabaseClient,
  eventId: string,
  source: string,
): Promise<StructuredData | null> {
  const since = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("event_structured_data_latest")
    .select("source, source_version, payload, summary_lines, fetched_at")
    .eq("event_id", eventId)
    .eq("source", source)
    .gt("fetched_at", since)
    .maybeSingle();

  if (error || !data) return null;

  return {
    source: data.source,
    source_version: data.source_version,
    fetched_at: data.fetched_at,
    payload: (data.payload ?? {}) as Record<string, unknown>,
    summary_lines: Array.isArray(data.summary_lines) ? data.summary_lines : [],
  };
}

export async function persistStructuredData(
  supabase: SupabaseClient,
  eventId: string,
  data: StructuredData,
): Promise<void> {
  const { error } = await supabase.from("event_structured_data").insert({
    event_id: eventId,
    source: data.source,
    source_version: data.source_version,
    payload: data.payload,
    summary_lines: data.summary_lines,
    fetched_at: data.fetched_at,
  });
  if (error) {
    console.warn(`[structuredData] persist failed for ${eventId}: ${error.message}`);
  }
}

/**
 * Shared formatter. Renders the universal STRUCTURED DATA prompt block.
 * Returns empty string when data is null or has no summary lines (safe to
 * concatenate unconditionally).
 */
export function formatStructuredDataBlock(data: StructuredData | null): string {
  if (!data || data.summary_lines.length === 0) return "";

  return [
    "",
    `STRUCTURED DATA (verified factual record from ${data.source}):`,
    ...data.summary_lines.map((line) => `- ${line}`),
    "",
    "Use it as primary factual ground truth; the research and market signals above remain useful context but defer to these facts where they conflict.",
    "",
  ].join("\n");
}
