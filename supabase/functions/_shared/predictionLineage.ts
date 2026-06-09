// Shared helper: write a prediction_inputs lineage row.
//
// Both the cron path (generate-prediction) and the user path
// (submit-question) call this helper so lineage capture cannot drift
// between them. Best-effort: a failure here MUST NOT fail the forecast.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractSignalsUsed, estimatePromptTokens } from "./signals.ts";
import type { DomainId } from "./domains/registry.ts";

export interface LineagePrior {
  prediction_id: string;
  event_id: string;
  similarity: number;
  top_pick_label: string | null;
  top_pick_prob: number | null;
  was_correct: boolean | null;
}

export interface LineageMarketSignal {
  venue: string;
  market_outcome_label: string;
  implied_probability: number;
  fetched_at: string;
  age_minutes_at_call: number;
}

export interface LineageStructuredData {
  source: string;
  source_version: string | null;
  fetched_at: string;
  summary_lines: string[];
}

export interface LineageStructuredSource {
  name: string;
  fetched_at: string;
  duration_ms: number;
}

export interface LineageInput {
  supabase: SupabaseClient;
  prediction_id: string;
  event_id: string;
  prompt_resolved: string;
  domain: DomainId | string;
  // ModelRanking[] from runConsensus; typed loose to avoid import cycles.
  model_results: unknown;
  prompt_version: string;
  /** ms epoch when the forecast call began. */
  time_of_call: number;
  research_tokens_used: number | null;
  priors: LineagePrior[];
  top_pick_prob_raw: number | null;
  market_signals: LineageMarketSignal[];
  structured_data: LineageStructuredData | null;
  structured_sources: LineageStructuredSource[];
}

export async function writePredictionLineage(i: LineageInput): Promise<void> {
  try {
    const signals = extractSignalsUsed(
      i.domain as DomainId,
      // deno-lint-ignore no-explicit-any
      (i.model_results ?? []) as any,
    );
    const promptTokens = estimatePromptTokens(i.prompt_resolved ?? "");

    const { error } = await i.supabase.from("prediction_inputs").insert({
      prediction_id: i.prediction_id,
      event_id: i.event_id,
      prompt_resolved: i.prompt_resolved,
      signals_used: signals,
      time_of_call: new Date(i.time_of_call).toISOString(),
      research_tokens_used: i.research_tokens_used,
      llm_input_tokens_est: promptTokens,
      prompt_version: i.prompt_version,
      prior_predictions_used: i.priors.map((p) => ({
        prediction_id: p.prediction_id,
        event_id: p.event_id,
        similarity: p.similarity,
        top_pick_label: p.top_pick_label,
        top_pick_prob: p.top_pick_prob,
        was_correct: p.was_correct,
      })),
      top_pick_prob_raw: i.top_pick_prob_raw,
      market_signals_used: i.market_signals.map((s) => ({
        venue: s.venue,
        outcome_label: s.market_outcome_label,
        implied_probability: s.implied_probability,
        fetched_at: s.fetched_at,
        age_minutes_at_call: s.age_minutes_at_call,
      })),
      structured_data_used: i.structured_data
        ? {
            source: i.structured_data.source,
            source_version: i.structured_data.source_version,
            fetched_at: i.structured_data.fetched_at,
            age_minutes_at_call: Math.floor(
              (Date.now() - new Date(i.structured_data.fetched_at).getTime()) /
                60_000,
            ),
            line_count: i.structured_data.summary_lines.length,
          }
        : {},
      structured_data_sources: i.structured_sources.map((s) => ({
        name: s.name,
        fetched_at: s.fetched_at,
        duration_ms: s.duration_ms,
      })),
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn(
      `[lineage] prediction_inputs insert failed for ${i.prediction_id}: ${(e as Error).message}`,
    );
  }
}
