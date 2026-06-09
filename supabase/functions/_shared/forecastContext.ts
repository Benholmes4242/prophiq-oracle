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

/** True when the extracted runners came from the golf adapter (players, no
 * odds). Used by the outcome-rewrite to pick the correct bucket label
 * ("Any other player" vs "Any other runner"). */
export function isGolfRunnersSource(ctx: StructuredDataContext): boolean {
  const hasRacing = ctx.sources.some((s) => {
    if (s.name !== "racingApi") return false;
    const d = s.data as { runners?: unknown[] } | null;
    return !!d && Array.isArray(d.runners) && d.runners.length > 0;
  });
  if (hasRacing) return false;
  return ctx.sources.some((s) => {
    if (s.name !== "sportRadarGolf") return false;
    const d = s.data as { runners?: unknown[] } | null;
    return !!d && Array.isArray(d.runners) && d.runners.length > 0;
  });
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

  // Horse-racing safety net (shared with generate-prediction): web
  // research cannot reliably enumerate a specific race's runners, so
  // research_grounded for a race without a feed-backed field is worse
  // than honest uncertainty (it surfaces fabricated "Horse A" / "Any
  // other runner wins" placeholders at #1). Force low_data when racing
  // has no real feed; the rest of the tiering logic stays unchanged for
  // every other sport / domain.
  const eventMeta = (event as { metadata?: unknown }).metadata;
  const subCategory = (eventMeta && typeof eventMeta === "object")
    ? String((eventMeta as Record<string, unknown>).sub_category ?? "").toLowerCase()
    : "";
  const isHorseRacing = subCategory === "horse_racing" || subCategory === "horseracing";
  const racingPlaceholderGuard = isHorseRacing && !hasFeed;

  const dataTier: DataTier = hasFeed
    ? "feed_backed"
    : (hasSubstantiveResearch && !racingPlaceholderGuard)
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

  // ----- Racing runners (only populated when racingApi source matched) -----
  const racingRunners = extractRacingRunners(structuredSources);

  return {
    research,
    researchError,
    priors,
    marketSignals,
    structuredData,
    structuredSources,
    dataTier,
    dataSources,
    racingRunners,
    prompt,
  };
}

export function extractRacingRunners(
  ctx: StructuredDataContext,
): RacingRunnerSummary[] | null {
  // Racing first (UK/IRE + NA cards). Golf is a fallback that reuses the
  // same downstream rewrite — players map to runners, no odds.
  const racing = ctx.sources.find((s) => s.name === "racingApi");
  if (racing && racing.data && typeof racing.data === "object") {
    const d = racing.data as {
      runners?: Array<{
        horse?: string;
        odds?: Array<{ decimal?: number | string | null }> | null;
      }>;
    };
    if (Array.isArray(d.runners) && d.runners.length > 0) {
      const runners: RacingRunnerSummary[] = d.runners
        .map((r) => {
          const horse = String(r.horse ?? "").trim();
          if (!horse) return null;
          const decs: number[] = [];
          for (const o of r.odds ?? []) {
            const v = typeof o.decimal === "number" ? o.decimal : Number(o.decimal);
            if (Number.isFinite(v) && v > 0) decs.push(v);
          }
          return {
            horse,
            odds: decs.length > 0 ? Math.min(...decs) : null,
          };
        })
        .filter((r): r is RacingRunnerSummary => r !== null);
      if (runners.length > 0) {
        const priced = runners.filter((r) => r.odds !== null).sort((a, b) => (a.odds! - b.odds!));
        const unpriced = runners.filter((r) => r.odds === null);
        return [...priced, ...unpriced];
      }
    }
  }

  // Golf: players are pre-sorted leader-first by the adapter; preserve order.
  const golf = ctx.sources.find((s) => s.name === "sportRadarGolf");
  if (golf && golf.data && typeof golf.data === "object") {
    const d = golf.data as { runners?: Array<{ horse?: string }> };
    if (Array.isArray(d.runners) && d.runners.length > 0) {
      const players: RacingRunnerSummary[] = d.runners
        .map((r) => {
          const horse = String(r.horse ?? "").trim();
          return horse ? { horse, odds: null } : null;
        })
        .filter((p): p is RacingRunnerSummary => p !== null);
      if (players.length > 0) return players;
    }
  }

  return null;
}

