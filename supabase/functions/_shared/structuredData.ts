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

// ============================================================
// Brief GG: multi-source structured-data context.
//
// The legacy `StructuredData` shape above is a single source per call
// (api-sports football v3). Brief GG introduces a multi-source aggregation
// shape so each domain can pull from 2+ feeds in parallel (e.g. politics
// gets Polymarket + Kalshi). Adapters opt in by implementing
// `gatherStructuredSources` on the DomainAdapter interface. The orchestrator
// runs the call alongside research+priors+markets, formats the result via
// `formatStructuredSourcesBlock`, and appends the block to the prompt.
// ============================================================

export interface StructuredDataSource {
  name: string;
  // deno-lint-ignore no-explicit-any
  data: any;
  fetched_at: string;
  duration_ms: number;
}

export interface StructuredDataError {
  source: string;
  message: string;
  duration_ms: number;
}

export interface StructuredDataContext {
  sources: StructuredDataSource[];
  errors: StructuredDataError[];
  total_duration_ms: number;
  /**
   * Optional. Set by adapters whose grounding produces a real, ordered
   * field of outcome labels (favourite-first). The cron caller swaps
   * these in for the prompt + consensus instead of the placeholder
   * outcomes from discovery. Unset by adapters that don't ground
   * outcomes (politics / markets / entertainment) — interface is
   * unchanged for them.
   */
  groundedOutcomes?: string[];
}

export const STRUCTURED_DATA_TIMEOUT_MS = 5000;

export function emptyStructuredDataContext(): StructuredDataContext {
  return { sources: [], errors: [], total_duration_ms: 0 };
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

/**
 * Render the multi-source STRUCTURED DATA block. Returns empty string when
 * no sources contributed (safe to concatenate unconditionally). The block
 * sits between LIVE RESEARCH CONTEXT and PRIOR FORECASTS in the prompt.
 */
export function formatStructuredSourcesBlock(ctx: StructuredDataContext): string {
  if (ctx.sources.length === 0) return "";

  const lines: string[] = ["", "STRUCTURED DATA FROM EXTERNAL SOURCES:", ""];

  for (const source of ctx.sources) {
    lines.push(`[${source.name}]`);
    lines.push(
      typeof source.data === "string"
        ? source.data
        : JSON.stringify(source.data, null, 2),
    );
    lines.push("");
  }

  if (ctx.errors.length > 0) {
    lines.push(
      `(Some sources were unavailable: ${ctx.errors.map((e) => e.source).join(", ")})`,
    );
    lines.push("");
  }

  lines.push(
    "Consider this structured data alongside the live research. Where they conflict, prefer structured data for numeric facts and recent prices, and prefer live research for context and qualitative reasoning.",
  );
  lines.push("");

  return lines.join("\n");
}
