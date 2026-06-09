// POST /functions/v1/generate-prediction
// Body: { event_id: string, mode?: "prediction"|"odds", force?: boolean }
//
// Loads the event + outcomes, fetches live research via Perplexity, builds
// the domain-specific prompt with research, fans out to Claude/GPT/Gemini in
// parallel, runs weighted Borda consensus, and writes a new `predictions`
// row (marking the prior current-prediction stale). The research payload is
// stored on the row for lineage.

import { registerAllDomains } from "../_shared/domains/index.ts";
import { getDomain } from "../_shared/domains/registry.ts";
import { runConsensus } from "../_shared/runConsensus.ts";
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";
import { extractSignalsUsed, estimatePromptTokens } from "../_shared/signals.ts";
import { extractEntities } from "../_shared/entities.ts";
import { embedText, buildEmbeddingInput, EMBEDDING_MODEL_ID } from "../_shared/embeddings.ts";
import {
  PRIOR_CONTEXT_LIMIT,
  PRIOR_CONTEXT_MIN_SIMILARITY,
  type PriorContext,
} from "../_shared/priorContext.ts";
import {
  loadCalibrationCurve,
  calibrateRankedOutcomes,
  type CalibrationCurve,
} from "../_shared/calibration.ts";
import { gatherMarketSignals, type MarketSignal } from "../_shared/marketSignals.ts";
import {
  type StructuredData,
  type StructuredDataContext,
  emptyStructuredDataContext,
  formatStructuredSourcesBlock,
} from "../_shared/structuredData.ts";

import type {
  DomainEvent,
  EventOutcome,
  ResearchContext,
  ResearchContextError,
} from "../_shared/domain.ts";
import { extractUserIfAuthenticated } from "../_shared/auth.ts";
import { lowDataDisciplineBlock } from "../_shared/forecastDiscipline.ts";

registerAllDomains();

const PROMPT_VERSION = "v1.4.0"; // bumped from v1.3.0 - structured data injection
import { PREDICTION_CACHE_TTL_MS } from "../_shared/cacheTtl.ts";
const STALE_AFTER_MS = PREDICTION_CACHE_TTL_MS;
const RESEARCH_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface Body { event_id?: string; mode?: "prediction" | "odds"; force?: boolean; }

// In-memory research cache, scoped to this function instance. Keyed by
// event_id. Edge function instances are short-lived but burst traffic for
// the same event can hit this and avoid duplicate Perplexity calls.
const researchCache = new Map<string, { research: ResearchContext; cached_at: number }>();

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: Body;
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body"); }
  if (!body.event_id || typeof body.event_id !== "string") return errorResponse("event_id required");
  const mode: "prediction" | "odds" = body.mode === "odds" ? "odds" : "prediction";

  const supabase = getServiceClient();

  // Optional: capture user_id for observability when called by an authenticated
  // frontend. Cron / service-role invocations pass no JWT and yield null.
  const authedUser = await extractUserIfAuthenticated(req, supabase);
  if (authedUser) {
    console.log(`[generate-prediction] user_triggered=${authedUser.user_id} anonymous=${authedUser.is_anonymous}`);
  }


  const { data: event, error: evErr } = await supabase
    .from("events").select("*").eq("id", body.event_id).single();
  if (evErr || !event) return errorResponse(`event not found: ${evErr?.message ?? body.event_id}`, 404);

  if (mode === "odds" && event.mode === "prediction") {
    return errorResponse("event does not support odds mode", 422);
  }

  let { data: outcomes, error: oErr } = await supabase
    .from("event_outcomes").select("*").eq("event_id", body.event_id).order("created_at");
  if (oErr) return errorResponse(`outcomes load failed: ${oErr.message}`, 500);
  if (!outcomes || outcomes.length < 2) return errorResponse("event has <2 outcomes", 422);

  // Reuse fresh prediction (scoped to mode) unless forced
  if (!body.force) {
    const { data: existing } = await supabase
      .from("predictions").select("*")
      .eq("event_id", body.event_id).eq("mode", mode).eq("is_current", true).maybeSingle();
    if (existing) {
      const age = Date.now() - new Date(existing.generated_at).getTime();
      if (age < STALE_AFTER_MS) return jsonResponse({ prediction: existing, reused: true });
    }
  }

  // ============================================================
  // Lazy embedding for this event (best-effort).
  // Placed AFTER cached-prediction reuse (so cached paths don't burn an
  // OpenAI call) and BEFORE research fetch.
  // ============================================================
  if (!event.embedding) {
    try {
      const input = buildEmbeddingInput({
        title: event.title,
        question: event.question,
      });
      if (input.length > 0) {
        const embedding = await embedText(input);
        const { error: embErr } = await supabase
          .from("events")
          .update({
            embedding,
            embedding_model: EMBEDDING_MODEL_ID,
            embedded_at: new Date().toISOString(),
          })
          .eq("id", body.event_id);
        if (embErr) throw new Error(embErr.message);
        console.log(
          `[generate-prediction] event=${body.event_id} embedded model=${EMBEDDING_MODEL_ID}`,
        );
      }
    } catch (e) {
      console.warn(
        `[generate-prediction] embedding failed for event ${body.event_id}: ${(e as Error).message}`,
      );
    }
  }

  const adapter = getDomain(event.domain);

  // Capture when inputs were assembled - before any LLM calls fire.
  const timeOfCall = Date.now();

  // ----- Fetch live research with in-memory cache + graceful fallback -----
  let research: ResearchContext | null = null;
  let researchError: ResearchContextError | null = null;

  const cached = researchCache.get(body.event_id);
  if (cached && Date.now() - cached.cached_at < RESEARCH_CACHE_TTL_MS) {
    research = cached.research;
    console.log(`[generate-prediction] event=${body.event_id} research_cache_hit=true`);
  } else {
    const startedAt = Date.now();
    try {
      research = await adapter.gatherResearch(event as DomainEvent, outcomes as EventOutcome[]);
      if (research) {
        researchCache.set(body.event_id, { research, cached_at: Date.now() });
        console.log(
          `[generate-prediction] event=${body.event_id} research_fetched_in=${Date.now() - startedAt}ms model=${research.model} tokens=${research.tokens_used ?? "?"}`,
        );
      }
    } catch (e) {
      const reason = (e as Error).message || "unknown research fetch error";
      console.warn(`[generate-prediction] research fetch failed for event ${body.event_id}: ${reason}`);
      researchError = { error: true, reason, fetched_at: new Date().toISOString() };
      research = null;
    }
  }

  // ============================================================
  // Prior context: similar resolved past forecasts (Brief W).
  // Feature-flagged for safe rollout. Best-effort: failure logs but
  // does not block the forecast (falls through to research-only).
  // ============================================================
  const priorContextEnabled =
    (Deno.env.get("PRIOR_CONTEXT_ENABLED") ?? "true").toLowerCase() !== "false";
  let priors: PriorContext[] = [];
  if (priorContextEnabled) {
    try {
      const { data, error } = await supabase.rpc("get_prior_context_for_event", {
        p_query_event_id: body.event_id,
        p_limit: PRIOR_CONTEXT_LIMIT,
        p_min_similarity: PRIOR_CONTEXT_MIN_SIMILARITY,
      });
      if (error) throw new Error(error.message);
      if (Array.isArray(data) && data.length > 0) {
        priors = data as PriorContext[];
        console.log(
          `[generate-prediction] event=${body.event_id} priors_loaded=${priors.length}`,
        );
      }
    } catch (e) {
      console.warn(
        `[generate-prediction] prior context fetch failed for event ${body.event_id}: ${(e as Error).message}`,
      );
      priors = [];
    }
  }

  // ============================================================
  // Phase 2: Market signals from prediction markets (best-effort)
  // ============================================================
  const marketSignalsEnabled =
    (Deno.env.get("MARKET_SIGNALS_ENABLED") ?? "true").toLowerCase() !== "false";
  let marketSignals: MarketSignal[] = [];
  if (marketSignalsEnabled) {
    try {
      marketSignals = await gatherMarketSignals(
        supabase,
        {
          id: event.id,
          title: event.title,
          question: event.question,
          domain: event.domain,
        },
        (outcomes as EventOutcome[]).map((o) => ({ id: o.id, label: o.label })),
      );
      if (marketSignals.length > 0) {
        console.log(
          `[generate-prediction] event=${body.event_id} market_signals_loaded=${marketSignals.length}`,
        );
      }
    } catch (e) {
      console.warn(
        `[generate-prediction] market signals fetch failed for event ${body.event_id}: ${(e as Error).message}`,
      );
      marketSignals = [];
    }
  }

  // ============================================================
  // Phase 3: Structured data feeds (best-effort, per-domain)
  // ============================================================
  const structuredDataEnabled =
    (Deno.env.get("STRUCTURED_DATA_ENABLED") ?? "true").toLowerCase() !== "false";
  let structuredData: StructuredData | null = null;
  let structuredSources: StructuredDataContext = emptyStructuredDataContext();
  if (structuredDataEnabled) {
    const [legacyRes, sourcesRes] = await Promise.allSettled([
      typeof adapter.gatherStructuredData === "function"
        ? adapter.gatherStructuredData(
            supabase,
            event as DomainEvent,
            outcomes as EventOutcome[],
          )
        : Promise.resolve(null),
      typeof adapter.gatherStructuredSources === "function"
        ? adapter.gatherStructuredSources(
            supabase,
            event as DomainEvent,
            outcomes as EventOutcome[],
          )
        : Promise.resolve(emptyStructuredDataContext()),
    ]);

    if (legacyRes.status === "fulfilled") {
      structuredData = legacyRes.value;
      if (structuredData) {
        console.log(
          `[generate-prediction] event=${body.event_id} structured_data_loaded source=${structuredData.source} lines=${structuredData.summary_lines.length}`,
        );
      }
    } else {
      console.warn(
        `[generate-prediction] structured data fetch failed for event ${body.event_id}: ${(legacyRes.reason as Error).message}`,
      );
    }

    if (sourcesRes.status === "fulfilled") {
      structuredSources = sourcesRes.value;
      if (structuredSources.sources.length > 0) {
        console.log(
          `[generate-prediction] event=${body.event_id} structured_sources_loaded=${structuredSources.sources.map((s) => s.name).join(",")} errors=${structuredSources.errors.length}`,
        );
      }
    } else {
      console.warn(
        `[generate-prediction] structured sources fetch failed for event ${body.event_id}: ${(sourcesRes.reason as Error).message}`,
      );
    }
  }

  // ============================================================
  // Sport grounding (Step 3, clean return): when the adapter's
  // gatherStructuredSources produced a real favourite-first field
  // of outcome labels, swap them in for the prompt + consensus.
  // In-memory only — no DB round-trip. The prediction row stores
  // outcome_label inline via ranked_outcomes, so downstream UI
  // sees the real names without needing event_outcomes mutated.
  // Non-sport adapters never set groundedOutcomes; this is a no-op.
  // ============================================================
  const groundedOutcomes = structuredSources.groundedOutcomes;
  if (groundedOutcomes && groundedOutcomes.length >= 2) {
    const synthetic: EventOutcome[] = groundedOutcomes.map((label) => ({
      id: `grounded:${label}`,
      event_id: event.id,
      external_id: label,
      label,
      metadata: null,
    } as EventOutcome));
    const oldLabels = (outcomes as EventOutcome[]).map((o) => o.label).join("|");
    const newLabels = groundedOutcomes.join("|");
    if (oldLabels !== newLabels) {
      outcomes = synthetic;
      console.log(
        `[generate-prediction] event=${body.event_id} outcomes_grounded=${synthetic.length} (in-memory swap from groundedOutcomes)`,
      );
    }
  }


  // ============================================================
  // Trust layer: classify what real evidence backs this forecast.
  //   feed_backed       — at least one structured feed returned data
  //   research_grounded — no feed, but substantive web research
  //   low_data          — neither; honest "we don't really know" mode
  // The tier drives both prompt enforcement (low_data forces a wide,
  // uncertain, no-fabrication distribution) and surfacing decisions
  // (low_data is excluded from home/featured/notable downstream).
  // ============================================================
  const hasFeed =
    structuredData !== null || (structuredSources?.sources?.length ?? 0) > 0;
  const researchText = (research?.synthesised ?? "").trim();
  const hasSubstantiveResearch =
    research !== null && researchText.length >= 200;

  const dataTier: "feed_backed" | "research_grounded" | "low_data" = hasFeed
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

  console.log(
    `[generate-prediction] event=${body.event_id} data_tier=${dataTier} feed_sources=${dataSources.feed.length} research_chars=${researchText.length}`,
  );

  // ----- Build prompt with research + priors + markets + structured woven in -----
  let prompt = adapter.buildPrompt(
    event as DomainEvent,
    outcomes as EventOutcome[],
    mode,
    research ?? undefined,
    priors.length > 0 ? priors : undefined,
    marketSignals.length > 0 ? marketSignals : undefined,
    structuredData,
  );

  // Brief GG: append multi-source STRUCTURED DATA block (empty string when
  // no adapter implements gatherStructuredSources yet, so this is a no-op
  // during Phase A rollout).
  const sourcesBlock = formatStructuredSourcesBlock(structuredSources);
  if (sourcesBlock.length > 0) prompt = `${prompt}\n${sourcesBlock}`;

  // Trust layer: if we have no real data, append the strict no-fabrication
  // block. The standard discipline block already lives inside each domain
  // adapter's buildPrompt; this is an additional, stricter constraint.
  if (dataTier === "low_data") {
    prompt = `${prompt}\n${lowDataDisciplineBlock()}`;
  }

  // ----- Run consensus -----
  let consensusOut;
  try {
    consensusOut = await runConsensus({
      prompt,
      outcomes: (outcomes as EventOutcome[]).map((o) => ({ id: o.id, label: o.label })),
      research,
      priors: priors.length > 0 ? priors : null,
      marketSignals: marketSignals.length > 0 ? marketSignals : null,
      structuredData,
    });
  } catch (e) {
    return errorResponse(`consensus failed: ${(e as Error).message}`, 502);
  }

  const labelById = new Map((outcomes as EventOutcome[]).map((o) => [o.id, o.label]));
  const ranked = consensusOut.consensus.ranked_outcomes.map((r) => ({
    ...r,
    outcome_label: labelById.get(r.outcome_id) ?? r.outcome_id,
  }));
  const top3 = ranked.slice(0, 3);
  const alternates = ranked.filter((r) => r.is_dark_horse);

  // ============================================================
  // Phase 1: Apply post-hoc calibration mapping (best-effort)
  // ============================================================
  const calibrationMappingEnabled =
    (Deno.env.get("CALIBRATION_MAPPING_ENABLED") ?? "true").toLowerCase() !== "false";

  let calibrationCurve: CalibrationCurve | null = null;
  if (calibrationMappingEnabled) {
    try {
      calibrationCurve = await loadCalibrationCurve(supabase, event.domain);
    } catch (e) {
      console.warn(
        `[generate-prediction] calibration curve load failed for ${event.domain}: ${(e as Error).message}`,
      );
      calibrationCurve = null;
    }
  }

  // Capture raw top-pick probability BEFORE calibration (always, regardless of flag)
  const topPickProbRaw: number | null = ranked[0]?.probability ?? null;

  const calibratedTop3 = calibrationCurve
    ? calibrateRankedOutcomes(calibrationCurve, top3)
    : top3;
  const calibratedAlternates = calibrationCurve
    ? calibrateRankedOutcomes(calibrationCurve, alternates)
    : alternates;
  const calibrationCurveVersion: string | null = calibrationCurve?.version ?? null;

  if (calibrationCurve) {
    console.log(
      `[generate-prediction] event=${body.event_id} calibration_applied version=${calibrationCurve.version}`,
    );
  }

  // Mark prior predictions stale (same mode only), then insert the new
  // current row. The flip-then-insert pair is non-atomic, so two
  // simultaneous generations (e.g. cron + on-demand trigger) could both
  // insert is_current=true rows. A partial unique index
  // (uniq_current_prediction) is the source of truth — on collision we
  // re-run the flip and retry the insert once.
  const flipPrior = () =>
    supabase.from("predictions").update({ is_current: false })
      .eq("event_id", body.event_id).eq("mode", mode);
  await flipPrior();

  const research_context = research ?? researchError;

  const insertRow = {
    event_id: body.event_id,
    mode,
    ranked_outcomes: calibratedTop3,
    alternates: calibratedAlternates,
    consensus_method: consensusOut.consensus.method,
    consensus_score: consensusOut.consensus.consensus_score,
    agreement_score: consensusOut.consensus.agreement_score,
    model_results: consensusOut.model_results,
    research_context,
    prompt_version: PROMPT_VERSION,
    calibration_curve_version: calibrationCurveVersion,
    data_tier: dataTier,
    data_sources: dataSources,
    is_current: true,
    expires_at: new Date(Date.now() + STALE_AFTER_MS).toISOString(),
  };
  let { data: inserted, error: insErr } = await supabase
    .from("predictions").insert(insertRow).select("*").single();
  if (insErr && (insErr as { code?: string }).code === "23505") {
    // Concurrent writer beat us to the unique index. Flip again to clear
    // their row, then retry once. If it still fails, surface the error.
    console.warn(
      `[generate-prediction] is_current race detected for event=${body.event_id} mode=${mode}; retrying`,
    );
    await flipPrior();
    ({ data: inserted, error: insErr } = await supabase
      .from("predictions").insert(insertRow).select("*").single());
  }
  if (insErr) return errorResponse(`insert failed: ${insErr.message}`, 500);

  // =============================================================
  // LLM cost logging (best-effort, post-insert, behind a flag).
  // Never throws. Never blocks. A failure here cannot affect the
  // prediction the caller already received.
  // =============================================================
  const costLoggingEnabled =
    (Deno.env.get("LLM_COST_LOGGING_ENABLED") ?? "true").toLowerCase() !== "false";
  if (costLoggingEnabled) {
    try {
      const rows = (consensusOut.model_results ?? [])
        .filter((m) => m && typeof m.model === "string")
        .map((m) => ({
          prediction_id: inserted.id,
          event_id: body.event_id,
          domain: event.domain,
          model: m.model,
          input_tokens: m.usage?.input_tokens ?? null,
          output_tokens: m.usage?.output_tokens ?? null,
          latency_ms: typeof m.latency_ms === "number" ? Math.max(0, Math.floor(m.latency_ms)) : null,
          had_error: !!m.error,
          error_message: m.error ?? null,
        }));
      if (rows.length > 0) {
        const { error: costErr } = await supabase.from("llm_cost_events").insert(rows);
        if (costErr) {
          console.warn(
            `[generate-prediction] llm_cost_events insert failed for ${inserted.id}: ${costErr.message}`,
          );
        }
      }
    } catch (e) {
      console.warn(
        `[generate-prediction] llm_cost_events logging threw for ${inserted.id}: ${(e as Error).message}`,
      );
    }
  }


  // =============================================================
  // prediction_inputs lineage row (best-effort, do not fail forecast)
  // =============================================================
  try {
    const signals = extractSignalsUsed(event.domain, consensusOut.model_results);
    const researchTokens = research?.tokens_used ?? null;
    const promptTokens = estimatePromptTokens(prompt);

    const { error: lineageErr } = await supabase.from("prediction_inputs").insert({
      prediction_id: inserted.id,
      event_id: body.event_id,
      prompt_resolved: prompt,
      signals_used: signals,
      time_of_call: new Date(timeOfCall).toISOString(),
      research_tokens_used: researchTokens,
      llm_input_tokens_est: promptTokens,
      prompt_version: PROMPT_VERSION,
      prior_predictions_used: priors.map((p) => ({
        prediction_id: p.prediction_id,
        event_id: p.event_id,
        similarity: p.similarity,
        top_pick_label: p.top_pick_label,
        top_pick_prob: p.top_pick_prob,
        was_correct: p.was_correct,
      })),
      top_pick_prob_raw: topPickProbRaw,
      market_signals_used: marketSignals.map((s) => ({
        venue: s.venue,
        outcome_label: s.market_outcome_label,
        implied_probability: s.implied_probability,
        fetched_at: s.fetched_at,
        age_minutes_at_call: s.age_minutes_at_call,
      })),
      structured_data_used: structuredData
        ? {
            source: structuredData.source,
            source_version: structuredData.source_version,
            fetched_at: structuredData.fetched_at,
            age_minutes_at_call: Math.floor(
              (Date.now() - new Date(structuredData.fetched_at).getTime()) / 60_000,
            ),
            line_count: structuredData.summary_lines.length,
          }
        : {},
      structured_data_sources: structuredSources.sources.map((s) => ({
        name: s.name,
        fetched_at: s.fetched_at,
        duration_ms: s.duration_ms,
      })),
    });
    if (lineageErr) throw new Error(lineageErr.message);
  } catch (e) {
    console.warn(
      `[generate-prediction] prediction_inputs insert failed for ${inserted.id}: ${(e as Error).message}`,
    );
  }

  // =============================================================
  // Entity extraction (cached per event, best-effort)
  // =============================================================
  try {
    const { count } = await supabase
      .from("event_entities")
      .select("*", { count: "exact", head: true })
      .eq("event_id", body.event_id);

    if ((count ?? 0) === 0) {
      const entities = await extractEntities(event.question);
      if (entities.length > 0) {
        const { error: entErr } = await supabase.from("event_entities").insert(
          entities.map((e) => ({
            event_id: body.event_id,
            entity_value: e.value,
            entity_type: e.type,
            confidence: e.confidence,
            extractor: "claude-haiku-4-5",
          })),
        );
        if (entErr) throw new Error(entErr.message);
        console.log(
          `[generate-prediction] event=${body.event_id} extracted ${entities.length} entities`,
        );
      }
    }
  } catch (e) {
    console.warn(
      `[generate-prediction] entity extraction failed for event ${body.event_id}: ${(e as Error).message}`,
    );
  }

  return jsonResponse({
    prediction: inserted,
    consensus: consensusOut.consensus,
    research_fetched: research !== null,
    priors_used: priors.length,
    market_signals_used: marketSignals.length,
    structured_data_used: structuredData !== null,
    data_tier: dataTier,
    reused: false,
  });
});
