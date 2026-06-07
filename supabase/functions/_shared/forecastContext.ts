// Shared forecast-context assembly + data-tier classification.
//
// Used by submit-question to reach parity with generate-prediction's
// trust-layer logic. The cron path (generate-prediction) currently inlines
// equivalent logic; TODO: migrate generate-prediction to call this helper
// so the two paths can never drift again.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type {
  DomainAdapter,
  DomainEvent,
  EventOutcome,
  ResearchContext,
  ResearchContextError,
} from "./domain.ts";
import {
  type StructuredData,
  type StructuredDataContext,
  emptyStructuredDataContext,
  formatStructuredSourcesBlock,
} from "./structuredData.ts";
import { gatherMarketSignals, type MarketSignal } from "./marketSignals.ts";
import {
  PRIOR_CONTEXT_LIMIT,
  PRIOR_CONTEXT_MIN_SIMILARITY,
  type PriorContext,
} from "./priorContext.ts";
import { lowDataDisciplineBlock } from "./forecastDiscipline.ts";

export type DataTier = "feed_backed" | "research_grounded" | "low_data";

export interface RacingRunnerSummary {
  horse: string;
  odds: number | null; // best (lowest) decimal price across bookmakers, or null
}

export interface ForecastContextResult {
  research: ResearchContext | null;
  researchError: ResearchContextError | null;
  priors: PriorContext[];
  marketSignals: MarketSignal[];
  structuredData: StructuredData | null;
  structuredSources: StructuredDataContext;
  dataTier: DataTier;
  dataSources: {
    feed: string[];
    research: string | null;
    research_chars: number;
    research_error: string | null;
  };
  /** Non-null only when racingApi matched a race; ranked by odds (favourite first). */
  racingRunners: RacingRunnerSummary[] | null;
  prompt: string;
}

export interface AssembleOptions {
  mode?: "prediction" | "odds";
  /** Optional progress callback - submit-question pipes this into SSE. */
  onProgress?: (stage: "research" | "structured" | "priors" | "markets", status: "start" | "done", info?: Record<string, unknown>) => void;
  /** Disable expensive priors lookup (default: respect PRIOR_CONTEXT_ENABLED env). */
  includePriors?: boolean;
  /** Disable market signals fetch (default: respect MARKET_SIGNALS_ENABLED env). */
  includeMarketSignals?: boolean;
}

export async function assembleForecastContext(
  supabase: SupabaseClient,
  adapter: DomainAdapter,
  event: DomainEvent,
  outcomes: EventOutcome[],
  opts: AssembleOptions = {},
): Promise<ForecastContextResult> {
  const mode = opts.mode ?? "prediction";

  // ----- Research -----
  opts.onProgress?.("research", "start");
  let research: ResearchContext | null = null;
  let researchError: ResearchContextError | null = null;
  try {
    research = await adapter.gatherResearch(event, outcomes);
  } catch (e) {
    researchError = {
      error: true,
      reason: (e as Error).message || "unknown research fetch error",
      fetched_at: new Date().toISOString(),
    };
  }
  opts.onProgress?.("research", "done", {
    fetched: research !== null,
    chars: (research?.synthesised ?? "").length,
  });

  // ----- Structured data (legacy + multi-source) -----
  opts.onProgress?.("structured", "start");
  let structuredData: StructuredData | null = null;
  let structuredSources: StructuredDataContext = emptyStructuredDataContext();
  const structuredEnabled =
    (Deno.env.get("STRUCTURED_DATA_ENABLED") ?? "true").toLowerCase() !== "false";
  if (structuredEnabled) {
    const [legacyRes, sourcesRes] = await Promise.allSettled([
      typeof adapter.gatherStructuredData === "function"
        ? adapter.gatherStructuredData(supabase, event, outcomes)
        : Promise.resolve(null),
      typeof adapter.gatherStructuredSources === "function"
        ? adapter.gatherStructuredSources(supabase, event, outcomes)
        : Promise.resolve(emptyStructuredDataContext()),
    ]);
    if (legacyRes.status === "fulfilled") structuredData = legacyRes.value;
    if (sourcesRes.status === "fulfilled") structuredSources = sourcesRes.value;
  }
  opts.onProgress?.("structured", "done", {
    legacy: structuredData?.source ?? null,
    sources: structuredSources.sources.map((s) => s.name),
  });

  // ----- Priors (optional, cheap RPC) -----
  let priors: PriorContext[] = [];
  const priorsEnabled =
    opts.includePriors ??
    ((Deno.env.get("PRIOR_CONTEXT_ENABLED") ?? "true").toLowerCase() !== "false");
  if (priorsEnabled) {
    opts.onProgress?.("priors", "start");
    try {
      const { data, error } = await supabase.rpc("get_prior_context_for_event", {
        p_query_event_id: event.id,
        p_limit: PRIOR_CONTEXT_LIMIT,
        p_min_similarity: PRIOR_CONTEXT_MIN_SIMILARITY,
      });
      if (!error && Array.isArray(data)) priors = data as PriorContext[];
    } catch { /* swallow - priors are best-effort */ }
    opts.onProgress?.("priors", "done", { count: priors.length });
  }

  // ----- Market signals (optional) -----
  let marketSignals: MarketSignal[] = [];
  const marketsEnabled =
    opts.includeMarketSignals ??
    ((Deno.env.get("MARKET_SIGNALS_ENABLED") ?? "true").toLowerCase() !== "false");
  if (marketsEnabled) {
    opts.onProgress?.("markets", "start");
    try {
      marketSignals = await gatherMarketSignals(
        supabase,
        { id: event.id, title: event.title, question: event.question, domain: event.domain },
        outcomes.map((o) => ({ id: o.id, label: o.label })),
      );
    } catch { /* swallow - signals are best-effort */ }
    opts.onProgress?.("markets", "done", { count: marketSignals.length });
  }

  // ----- Trust-layer classification (IDENTICAL to generate-prediction) -----
  const hasFeed =
    structuredData !== null || (structuredSources?.sources?.length ?? 0) > 0;
  const researchText = (research?.synthesised ?? "").trim();
  const hasSubstantiveResearch = research !== null && researchText.length >= 200;
  const dataTier: DataTier = hasFeed
    ? "feed_backed"
    : hasSubstantiveResearch
      ? "research_grounded"
      : "low_data";

  const dataSources = {
    feed: [
      ...(structuredData ? [structuredData.source] : []),
      ...(structuredSources?.sources?.map((s) => s.name) ?? []),
    ],
    research: hasSubstantiveResearch ? (research?.model ?? "perplexity") : null,
    research_chars: researchText.length,
    research_error: researchError?.reason ?? null,
  };

  // ----- Prompt assembly (matches generate-prediction) -----
  let prompt = adapter.buildPrompt(
    event,
    outcomes,
    mode,
    research ?? undefined,
    priors.length > 0 ? priors : undefined,
    marketSignals.length > 0 ? marketSignals : undefined,
    structuredData,
  );
  const sourcesBlock = formatStructuredSourcesBlock(structuredSources);
  if (sourcesBlock.length > 0) prompt = `${prompt}\n${sourcesBlock}`;
  if (dataTier === "low_data") {
    prompt = `${prompt}\n${lowDataDisciplineBlock()}`;
  }

  return {
    research,
    researchError,
    priors,
    marketSignals,
    structuredData,
    structuredSources,
    dataTier,
    dataSources,
    prompt,
  };
}
