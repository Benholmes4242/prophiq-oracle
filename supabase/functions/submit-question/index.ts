// POST /functions/v1/submit-question
// SSE-streaming endpoint. Body: { question, fingerprint }
//
// Stages emitted as `data:` SSE events:
//   1. rate_limit  (start/done/error)
//   2. pre_filter  (start/done/error)
//   3. moderation  (start/done/error - may carry a reject reason)
//   4. research    (start/done - informational; populates description)
//   5. models      (start/done - runs 3 LLMs in parallel)
//   6. consensus   (start/done - computes weighted Borda)
//   7. done        (carries final event_id + prediction_id)

import { registerAllDomains } from "../_shared/domains/index.ts";
import { getDomain, tryGetDomain } from "../_shared/domains/registry.ts";
import { truncateQuestion } from "../_shared/rateLimit.ts";
import { preFilter, runModeration, defaultResolvesAt } from "../_shared/moderation.ts";
import { stableEventId } from "../_shared/domains/_util.ts";
import { runConsensus } from "../_shared/runConsensus.ts";
import { assembleForecastContext } from "../_shared/forecastContext.ts";
import type { DomainEvent, EventOutcome } from "../_shared/domain.ts";
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { scoreToConfidence } from "../_shared/confidence.ts";
import { requireAuthenticatedUser, type AuthedUser } from "../_shared/auth.ts";
import { PREDICTION_CACHE_TTL_MS } from "../_shared/cacheTtl.ts";
import {
  handleCorsPreflight, errorResponse,
  SseStream, getFingerprint, getClientIp, hashIp,
} from "../_shared/http.ts";

registerAllDomains();

const PROMPT_VERSION = "v1.0.0";

interface Body { question?: string; fingerprint?: string; }

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: Body;
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body"); }

  const question = (body.question ?? "").trim();
  const fingerprint = getFingerprint(body, req) ?? null;
  if (!question) return errorResponse("question required");

  const supabase = getServiceClient();

  // ----- AUTH (anonymous JWTs pass; missing/invalid -> 401) -----
  let authedUser: AuthedUser;
  try {
    authedUser = await requireAuthenticatedUser(req, supabase);
  } catch (r) {
    return r as Response;
  }

  const ip = getClientIp(req);
  const ipHash = await hashIp(ip);
  const sse = new SseStream();
  const response = sse.response();

  // Run the pipeline detached from the response so we can stream progressively.
  (async () => {
    const recordOutcome = async (outcome: "accepted" | "rejected_moderation" | "rejected_rate_limit" | "failed") => {
      try {
        await supabase.from("submission_rate_limits").insert({
          fingerprint: fingerprint ?? authedUser.user_id, ip_hash: ipHash, endpoint: "submit_question",
          question: truncateQuestion(question), outcome,
        });
      } catch { /* audit failure should not break the user flow */ }
    };

    // Best-effort search analytics. Never throws. Writes one row per submission
    // exit path. result_type:
    //   matched   - upsert hit an existing event
    //   generated - upsert created a new event
    //   rejected  - moderation rejected (pre-filter, off-topic, uncategorisable)
    //   failed    - processing error
    const normalizeForSearch = (q: string): string =>
      q.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
    const logSearchQuery = async (params: {
      result_type: "matched" | "generated" | "rejected" | "failed";
      domain?: string | null;
      matched_event_id?: string | null;
    }) => {
      try {
        await supabase.from("search_queries").insert({
          user_id: authedUser.user_id,
          fingerprint: fingerprint ?? null,
          question,
          question_normalized: normalizeForSearch(question),
          domain: params.domain ?? null,
          result_type: params.result_type,
          matched_event_id: params.matched_event_id ?? null,
        });
      } catch (e) {
        console.warn("[submit-question] logSearchQuery failed:", (e as Error).message);
      }
    };

    try {
      // ----- 0. SUSPENSION CHECK (Brief II.C C.4) -----
      // Neutral message; do not leak the reason. Runs ahead of quota so a
      // suspended user never burns moderation cycles.
      {
        const { data: profileRow, error: profileErr } = await supabase
          .from("profiles")
          .select("suspended_at")
          .eq("id", authedUser.user_id)
          .maybeSingle();
        if (profileErr) {
          console.error("[submit-question] suspension check failed:", profileErr.message);
        } else if (profileRow?.suspended_at) {
          sse.send({
            stage: "suspended",
            status: "error",
            message: "This account cannot submit questions. Contact support.",
          });
          await recordOutcome("failed");
          await logSearchQuery({ result_type: "failed" });
          sse.close();
          return;
        }
      }

      // ----- 1. RATE LIMIT (per user_id, per-tier daily cap via get_user_quota_today) -----
      sse.send({ stage: "rate_limit", status: "start" });
      const { data: quotaData, error: quotaErr } = await supabase
        .rpc("get_user_quota_today", { p_user_id: authedUser.user_id });
      if (quotaErr) {
        console.error("[submit-question] quota RPC failed:", quotaErr.message);
        sse.send({ stage: "rate_limit", status: "error", message: "Could not check usage quota" });
        await recordOutcome("failed"); await logSearchQuery({ result_type: "failed" }); sse.close(); return;
      }
      const quotaRow = (Array.isArray(quotaData) ? quotaData[0] : quotaData) as {
        used_today: number;
        daily_cap: number;
        remaining: number;
        tier: string;
        is_trialing: boolean;
        trial_end: string | null;
        subscription_status: string;
      } | null;
      if (!quotaRow) {
        console.error("[submit-question] quota RPC returned no row");
        sse.send({ stage: "rate_limit", status: "error", message: "Could not check usage quota" });
        await recordOutcome("failed"); await logSearchQuery({ result_type: "failed" }); sse.close(); return;
      }
      if (quotaRow.remaining <= 0) {
        sse.send({
          stage: "rate_limit", status: "error",
          message: `Daily question limit reached (${quotaRow.used_today}/${quotaRow.daily_cap}).`,
          data: {
            code: "DAILY_LIMIT_REACHED",
            used: quotaRow.used_today,
            used_today: quotaRow.used_today,
            cap: quotaRow.daily_cap,
            daily_cap: quotaRow.daily_cap,
            tier: quotaRow.tier,
            is_trialing: quotaRow.is_trialing,
            trial_end: quotaRow.trial_end,
            subscription_status: quotaRow.subscription_status,
          },
        });
        await recordOutcome("rejected_rate_limit"); await logSearchQuery({ result_type: "failed" }); sse.close(); return;
      }
      sse.send({
        stage: "rate_limit", status: "done",
        data: {
          used: quotaRow.used_today,
          cap: quotaRow.daily_cap,
          tier: quotaRow.tier,
          is_trialing: quotaRow.is_trialing,
          trial_end: quotaRow.trial_end,
          subscription_status: quotaRow.subscription_status,
        },
      });

      // ----- 2. PRE-FILTER -----
      sse.send({ stage: "pre_filter", status: "start" });
      const pre = preFilter(question);
      if (!pre.ok) {
        sse.send({ stage: "pre_filter", status: "error", message: pre.reason });
        await recordOutcome("rejected_moderation");
        await logSearchQuery({ result_type: "rejected" });
        sse.close(); return;
      }
      sse.send({ stage: "pre_filter", status: "done" });

      // ----- 3. MODERATION -----
      sse.send({ stage: "moderation", status: "start" });
      const today = new Date();
      const mod = await runModeration(question, today);
      if (mod.decision === "reject") {
        sse.send({ stage: "moderation", status: "error", message: mod.reason ?? "rejected", data: mod });
        await recordOutcome("rejected_moderation");
        await logSearchQuery({ result_type: "rejected", domain: (mod.domain && tryGetDomain(mod.domain)) ? mod.domain : null });
        sse.close(); return;
      }
      const domainId = mod.domain && tryGetDomain(mod.domain) ? mod.domain : null;
      if (!domainId) {
        sse.send({ stage: "moderation", status: "error", message: "We couldn't categorise this question. Try one more specific to sport, politics, markets, or entertainment.", data: mod });
        await recordOutcome("rejected_moderation");
        await logSearchQuery({ result_type: "rejected" });
        sse.close(); return;
      }
      const normalized = mod.normalized_question ?? question;
      const startsAt = mod.starts_at ?? today.toISOString();
      const resolvesAt = defaultResolvesAt(mod, today);
      sse.send({ stage: "moderation", status: "done", data: { domain: domainId, normalized_question: normalized, starts_at: startsAt, resolves_at: resolvesAt } });

      // ----- 4. RESEARCH (informational stage - placeholder for now) -----
      sse.send({ stage: "research", status: "start" });
      const description = mod.metadata && typeof mod.metadata === "object" && typeof (mod.metadata as Record<string, unknown>).context === "string"
        ? (mod.metadata as Record<string, string>).context
        : null;
      sse.send({ stage: "research", status: "done", data: { description } });

      // ----- Upsert event + outcomes -----
      const externalId = await stableEventId(normalized, startsAt);
      const slug = `${domainId}-${externalId.slice(0, 12)}`;
      const outcomes = (mod.outcomes && mod.outcomes.length >= 2) ? mod.outcomes : ["Yes", "No"];

      // Pre-upsert existence check: did the event already exist? Drives the
      // matched-vs-generated distinction for search analytics. Cheap indexed
      // lookup on (domain, external_id).
      const { data: existing } = await supabase
        .from("events")
        .select("id")
        .eq("domain", domainId)
        .eq("external_id", externalId)
        .maybeSingle();
      const wasMatched = !!existing;

      const { data: event, error: evErr } = await supabase.from("events").upsert({
        domain: domainId,
        external_id: externalId,
        slug,
        title: normalized,
        description,
        question: normalized,
        starts_at: startsAt,
        resolves_at: resolvesAt,
        status: "scheduled",
        mode: "prediction",
        source: "user_submitted",
        submitted_by_user_id: authedUser.user_id,
        submitted_by_fingerprint: fingerprint,
        submitted_at: new Date().toISOString(),
        moderation_status: "approved",
        moderation_reason: null,
        moderation_metadata: mod.metadata ?? null,
        metadata: { source: "submit-question" },
      }, { onConflict: "domain,external_id" }).select("*").single();
      if (evErr || !event) {
        sse.send({ stage: "moderation", status: "error", message: `event upsert failed: ${evErr?.message}` });
        await recordOutcome("failed"); await logSearchQuery({ result_type: "failed", domain: domainId }); sse.close(); return;
      }

      const outcomeRows = outcomes.map((label) => ({
        event_id: event.id, external_id: label, label, metadata: null,
      }));
      const { error: oErr } = await supabase.from("event_outcomes").upsert(outcomeRows, { onConflict: "event_id,external_id" });
      if (oErr) {
        sse.send({ stage: "moderation", status: "error", message: `outcome upsert failed: ${oErr.message}` });
        await recordOutcome("failed"); await logSearchQuery({ result_type: "failed", domain: domainId, matched_event_id: event.id }); sse.close(); return;
      }

      const { data: outcomeIds } = await supabase
        .from("event_outcomes").select("id,label,external_id").eq("event_id", event.id).order("created_at");
      const outcomePairs = (outcomeIds ?? []).map((o) => ({ id: o.id, label: o.label }));

      // ----- 5. MODELS -----
      sse.send({ stage: "models", status: "start", data: { models: ["claude", "gpt", "gemini"] } });
      const adapter = tryGetDomain(domainId) ?? getDomain("sport"); // safe fallback prompt shape
      const prompt = adapter.buildPrompt(event as never, (outcomeIds ?? []) as never);

      let consensusOut;
      try {
        consensusOut = await runConsensus({ prompt, outcomes: outcomePairs });
      } catch (e) {
        sse.send({ stage: "models", status: "error", message: (e as Error).message });
        await recordOutcome("failed"); await logSearchQuery({ result_type: "failed", domain: domainId, matched_event_id: event.id }); sse.close(); return;
      }
      sse.send({ stage: "models", status: "done", data: { models_used: consensusOut.consensus.models_used, models_failed: consensusOut.consensus.models_failed } });

      // ----- 6. CONSENSUS -----
      sse.send({ stage: "consensus", status: "start" });
      const labelById = new Map((outcomeIds ?? []).map((o) => [o.id, o.label]));
      const ranked = consensusOut.consensus.ranked_outcomes.map((r) => ({
        ...r,
        outcome_label: labelById.get(r.outcome_id) ?? r.outcome_id,
      }));
      await supabase.from("predictions").update({ is_current: false }).eq("event_id", event.id).eq("mode", "prediction");
      const { data: prediction, error: pErr } = await supabase.from("predictions").insert({
        event_id: event.id,
        mode: "prediction",
        ranked_outcomes: ranked.slice(0, 3),
        alternates: ranked.filter((r) => r.is_dark_horse),
        consensus_method: consensusOut.consensus.method,
        consensus_score: consensusOut.consensus.consensus_score,
        agreement_score: consensusOut.consensus.agreement_score,
        model_results: consensusOut.model_results,
        research_context: null,
        prompt_version: PROMPT_VERSION,
        is_current: true,
        expires_at: new Date(Date.now() + PREDICTION_CACHE_TTL_MS).toISOString(),
      }).select("*").single();
      if (pErr) {
        sse.send({ stage: "consensus", status: "error", message: `prediction insert failed: ${pErr.message}` });
        await recordOutcome("failed"); await logSearchQuery({ result_type: "failed", domain: domainId, matched_event_id: event.id }); sse.close(); return;
      }
      sse.send({ stage: "consensus", status: "done", data: { confidence: scoreToConfidence(consensusOut.consensus.agreement_score) } });

      // ----- 7. DONE -----
      await recordOutcome("accepted");
      await logSearchQuery({
        result_type: wasMatched ? "matched" : "generated",
        domain: domainId,
        matched_event_id: event.id,
      });
      sse.send({ stage: "done", status: "done", data: { event_id: event.id, prediction_id: prediction.id, slug: event.slug, domain: domainId } });
      sse.close();
    } catch (err) {
      sse.send({ stage: "done", status: "error", message: (err as Error).message });
      try { await supabase.from("submission_rate_limits").insert({
        fingerprint: fingerprint ?? authedUser.user_id, ip_hash: ipHash, endpoint: "submit_question",
        question: truncateQuestion(question), outcome: "failed",
      }); } catch { /* swallow */ }
      await logSearchQuery({ result_type: "failed" });
      sse.close();
    }
  })();

  return response;
});
