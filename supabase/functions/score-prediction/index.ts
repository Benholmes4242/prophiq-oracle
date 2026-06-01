// POST /functions/v1/score-prediction
// Body: { event_id: string }
//
// Loads the event + current prediction + resolution (running the adapter's
// resolve() first if no resolution exists yet), scores the prediction with
// the shared scorer, and upserts into prediction_accuracy.

import { registerAllDomains } from "../_shared/domains/index.ts";
import { getDomain } from "../_shared/domains/registry.ts";
import { scorePrediction, type PredictedOutcome, type ActualOutcome } from "../_shared/scoring.ts";
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";
import type { DomainEvent, EventOutcome } from "../_shared/domain.ts";

registerAllDomains();

interface Body { event_id?: string; mode?: "prediction" | "odds"; }

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  let body: Body;
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body"); }
  if (!body.event_id) return errorResponse("event_id required");
  const mode: "prediction" | "odds" = body.mode === "odds" ? "odds" : "prediction";

  const supabase = getServiceClient();

  const { data: event, error: evErr } = await supabase
    .from("events").select("*").eq("id", body.event_id).single();
  if (evErr || !event) return errorResponse("event not found", 404);

  const { data: outcomes, error: oErr } = await supabase
    .from("event_outcomes").select("*").eq("event_id", body.event_id);
  if (oErr || !outcomes) return errorResponse(`outcomes load failed: ${oErr?.message}`, 500);

  const { data: prediction, error: pErr } = await supabase
    .from("predictions").select("*")
    .eq("event_id", body.event_id).eq("mode", mode).eq("is_current", true).maybeSingle();
  if (pErr) return errorResponse(`prediction load failed: ${pErr.message}`, 500);
  if (!prediction) return errorResponse(`no current ${mode} prediction to score`, 422);

  // Get-or-create resolution
  let { data: resolution } = await supabase
    .from("event_resolutions").select("*").eq("event_id", body.event_id).maybeSingle();

  if (!resolution) {
    const adapter = getDomain(event.domain);
    const res = await adapter.resolve(event as DomainEvent, outcomes as EventOutcome[]);
    if (!res) return jsonResponse({ resolved: false, reason: "adapter could not resolve yet" }, { status: 202 });
    const { data: inserted, error: rErr } = await supabase.from("event_resolutions").insert({
      event_id: body.event_id,
      outcome_rankings: res.outcome_rankings,
      source: res.source,
      resolution_context: res.resolution_context ?? null,
    }).select("*").single();
    if (rErr) return errorResponse(`resolution insert failed: ${rErr.message}`, 500);
    resolution = inserted;
    await supabase.from("events").update({ status: "resolved" }).eq("id", body.event_id);
  }

  const predicted: PredictedOutcome[] = (prediction.ranked_outcomes as Array<{ outcome_id: string; rank: number }>).map((r) => ({
    outcome_id: r.outcome_id, rank: r.rank,
  }));
  const actual: ActualOutcome[] = (resolution.outcome_rankings as Array<{ outcome_id: string; rank: number }>).map((r) => ({
    outcome_id: r.outcome_id, rank: r.rank,
  }));

  let scored;
  try { scored = scorePrediction(predicted, actual); }
  catch (e) { return errorResponse(`scoring failed: ${(e as Error).message}`, 500); }

  const { data: row, error: aErr } = await supabase.from("prediction_accuracy").upsert({
    prediction_id: prediction.id,
    event_id: body.event_id,
    domain: event.domain,
    mode: prediction.mode,
    pick_results: scored.pick_results,
    top_pick_correct: scored.top_pick_correct,
    picks_in_top_3: scored.picks_in_top_3,
    picks_in_top_5: scored.picks_in_top_5,
    picks_in_top_10: scored.picks_in_top_10,
    best_pick_actual_rank: scored.best_pick_actual_rank,
    average_predicted_rank: scored.average_predicted_rank,
    average_actual_rank: scored.average_actual_rank,
    accuracy_grade: scored.accuracy_grade,
    prompt_version: prediction.prompt_version,
    consensus_method: prediction.consensus_method,
  }, { onConflict: "event_id,mode" }).select("*").single();
  if (aErr) return errorResponse(`accuracy upsert failed: ${aErr.message}`, 500);

  return jsonResponse({ resolved: true, accuracy: row, scoring: scored });
});
