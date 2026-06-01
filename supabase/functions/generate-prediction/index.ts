// POST /functions/v1/generate-prediction
// Body: { event_id: string, force?: boolean }
//
// Loads the event + outcomes, builds the domain-specific prompt, fans out to
// Claude/GPT/Gemini in parallel, runs weighted Borda consensus, and writes a
// new `predictions` row (marking the prior current-prediction stale).

import { registerAllDomains } from "../_shared/domains/index.ts";
import { getDomain } from "../_shared/domains/registry.ts";
import { runConsensus } from "../_shared/runConsensus.ts";
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";
import type { DomainEvent, EventOutcome } from "../_shared/domain.ts";

registerAllDomains();

const PROMPT_VERSION = "v1.0.0";
const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

interface Body { event_id?: string; mode?: "prediction" | "odds"; force?: boolean; }

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: Body;
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body"); }
  if (!body.event_id || typeof body.event_id !== "string") return errorResponse("event_id required");
  const mode: "prediction" | "odds" = body.mode === "odds" ? "odds" : "prediction";

  const supabase = getServiceClient();

  const { data: event, error: evErr } = await supabase
    .from("events").select("*").eq("id", body.event_id).single();
  if (evErr || !event) return errorResponse(`event not found: ${evErr?.message ?? body.event_id}`, 404);

  if (mode === "odds" && event.mode === "prediction") {
    return errorResponse("event does not support odds mode", 422);
  }

  const { data: outcomes, error: oErr } = await supabase
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

  const adapter = getDomain(event.domain);
  const prompt = adapter.buildPrompt(event as DomainEvent, outcomes as EventOutcome[], mode);

  let consensusOut;
  try {
    consensusOut = await runConsensus({
      prompt,
      outcomes: (outcomes as EventOutcome[]).map((o) => ({ id: o.id, label: o.label })),
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

  // Mark prior predictions stale (same mode only)
  await supabase.from("predictions").update({ is_current: false })
    .eq("event_id", body.event_id).eq("mode", mode);

  const { data: inserted, error: insErr } = await supabase.from("predictions").insert({
    event_id: body.event_id,
    mode,
    ranked_outcomes: top3,
    alternates,
    consensus_method: consensusOut.consensus.method,
    consensus_score: consensusOut.consensus.consensus_score,
    agreement_score: consensusOut.consensus.agreement_score,
    model_results: consensusOut.model_results,
    research_context: null,
    prompt_version: PROMPT_VERSION,
    is_current: true,
    expires_at: new Date(Date.now() + STALE_AFTER_MS).toISOString(),
  }).select("*").single();
  if (insErr) return errorResponse(`insert failed: ${insErr.message}`, 500);

  return jsonResponse({
    prediction: inserted,
    consensus: consensusOut.consensus,
    reused: false,
  });
});
