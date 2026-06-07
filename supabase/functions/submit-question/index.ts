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

      // ----- 2.5 RACING CLARIFICATION (universal picker) -----
      // For horse-racing questions with a resolved course, decide BEFORE
      // moderation/forecast whether to short-circuit into a race picker:
      //
      //   US/CAN:
      //     - race number present -> forecast directly (fall through).
      //     - no race number      -> picker (pick_by: race_number).
      //
      //   UK/IRE (Standard endpoint):
      //     - time given AND exactly one race matches that local time -> direct.
      //     - time given but no clean match, OR no time at all, OR multiple
      //       matches -> picker (pick_by: time).
      //     - course/day unresolvable -> fall through to normal flow.
      // Hoisted so the post-block conversational fallback can reference them
      // when the picker recognised a racing course but couldn't pin a race.
      let racingClarified = false;
      let racingLooked = false;
      let racingCourse: string | null = null;
      let racingDateWord: "today" | "tomorrow" | null = null;
      try {
        const { parseRacingHints, isNorthAmericanTrack, fetchRacePicker } =
          await import("../_shared/dataSources/racingApi.ts");
        const { isHorseRacingEvent } = await import("../_shared/domains/sport.ts");
        const hints = { title: question, question, starts_at: new Date().toISOString() };
        const parsed = parseRacingHints(hints);
        const looksLikeRacing = isHorseRacingEvent({
          id: "stub", domain: "sport", title: question, question,
          starts_at: hints.starts_at, resolves_at: hints.starts_at,
          status: "scheduled", mode: "prediction", metadata: null,
        } as unknown as DomainEvent);
        racingLooked = looksLikeRacing;
        racingCourse = parsed.course;
        // Derive date_word from the parsed date for fallback messaging.
        if (parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
          const now = new Date();
          const todayISO = now.toISOString().slice(0, 10);
          const tmr = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
          if (parsed.date === todayISO) racingDateWord = "today";
          else if (parsed.date === tmr) racingDateWord = "tomorrow";
        }

        if (looksLikeRacing && parsed.course) {
          const isUS = isNorthAmericanTrack(parsed.course);
          const usNeedsPicker = isUS && parsed.raceNumber === null;
          const shouldConsult = isUS ? usNeedsPicker : true;

          if (shouldConsult) {
            const u = Deno.env.get("RACING_API_USERNAME");
            const p = Deno.env.get("RACING_API_PASSWORD");
            if (u && p) {
              const picker = await fetchRacePicker(u, p, hints);

              let emit = false;
              if (picker.kind === "races") {
                if (isUS) {
                  emit = true;
                } else if (parsed.time) {
                  const exact = picker.races.filter((r) => r.local_time === parsed.time);
                  emit = exact.length !== 1;
                } else {
                  emit = true;
                }
              } else if (picker.kind === "dark_day") {
                emit = true;
              }

              // Surface the decision values so silent fall-throughs are debuggable.
              console.log(
                `[submit-question] racing-decision isUS=${isUS} course=${parsed.course} time=${parsed.time ?? "-"} raceNumber=${parsed.raceNumber ?? "-"} picker.kind=${picker.kind} races=${picker.kind === "races" ? picker.races.length : 0} emit=${emit}`,
              );

              if (emit && picker.kind !== "unmatched") {
                const msg = picker.kind === "dark_day"
                  ? `${picker.track_name} isn't racing on ${picker.date}. Try a different date or track.`
                  : (isUS
                      ? `${picker.track_name} is a US track. US races are picked by race number. Which race would you like a forecast for?`
                      : `Which race at ${picker.track_name} would you like a forecast for?`);
                let dateWord: "today" | "tomorrow" | null = null;
                if (picker.date && /^\d{4}-\d{2}-\d{2}$/.test(picker.date)) {
                  const now = new Date();
                  const todayISO = now.toISOString().slice(0, 10);
                  const tmr = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
                  if (picker.date === todayISO) dateWord = "today";
                  else if (picker.date === tmr) dateWord = "tomorrow";
                }
                sse.send({
                  stage: "clarification",
                  status: "done",
                  data: {
                    type: "race_picker",
                    pick_by: picker.pick_by,
                    track_name: picker.track_name,
                    date: picker.date,
                    date_word: dateWord,
                    message: msg,
                    races: picker.kind === "races" ? picker.races : [],
                  },
                });
                racingClarified = true;
                sse.close();
                return;
              }
            } else {
              console.warn("[submit-question] race clarification skipped: RACING_API creds missing");
            }
          }
        }
      } catch (e) {
        // Clarification is best-effort; never block the normal pipeline.
        console.warn("[submit-question] race clarification failed:", (e as Error).message);
      }

      // ----- 2.6 RACING CONVERSATIONAL FALLBACK -----
      // We recognised a racing course but couldn't produce a confident
      // picker. Don't fall through to the generic forecast (it tends to
      // emit placeholder outcomes like "multiple race winners"). Ask the
      // user to clarify instead.
      if (!racingClarified && racingLooked && racingCourse) {
        const dateBit = racingDateWord ? ` ${racingDateWord}` : "";
        sse.send({
          stage: "clarification",
          status: "done",
          data: {
            type: "conversational",
            message: `I think you're asking about horse racing at ${racingCourse}${dateBit}. Tell me a race time (e.g. "16:18") or a race number, and I'll forecast it — or tap below to see the card.`,
            suggestions: [
              { label: `Show the card at ${racingCourse}`, reply: `show the card at ${racingCourse}${dateBit}` },
            ],
            original_question: question,
          },
        });
        sse.close();
        return;
      }




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

      // ----- 4. RESEARCH (description preview from moderation metadata) -----
      sse.send({ stage: "research", status: "start" });
      const description = mod.metadata && typeof mod.metadata === "object" && typeof (mod.metadata as Record<string, unknown>).context === "string"
        ? (mod.metadata as Record<string, string>).context
        : null;
      // Note: actual research fetch happens below in assembleForecastContext;
      // we keep this SSE stage for UX continuity (existing UI listens for it).
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

      // ----- Assemble forecast context (research + structured + priors + markets)
      // Parity with generate-prediction. Emits SSE progress so the user sees
      // motion during the 4-10s research fetch.
      const adapter = tryGetDomain(domainId) ?? getDomain("sport"); // safe fallback prompt shape
      sse.send({ stage: "context", status: "start" });
      const ctx = await assembleForecastContext(
        supabase,
        adapter,
        event as DomainEvent,
        (outcomeIds ?? []) as EventOutcome[],
        {
          mode: "prediction",
          onProgress: (stage, status, info) => {
            sse.send({ stage: `context_${stage}`, status, data: info });
          },
        },
      );
      sse.send({
        stage: "context",
        status: "done",
        data: { data_tier: ctx.dataTier, feed_sources: ctx.dataSources.feed, research_chars: ctx.dataSources.research_chars },
      });

      // ----- Racing runner rewrite -----
      // When racingApi matched a race, replace placeholder "Horse A/B/C wins"
      // outcomes with the real runners so the model ranks actual horses and
      // chips show real names. Guarded: non-racing events and racing events
      // without a matched card are untouched.
      let outcomePairs2 = outcomePairs;
      let outcomeIdsFinal = outcomeIds ?? [];
      if (ctx.racingRunners && ctx.racingRunners.length > 0) {
        const MAX_NAMED = 8;
        const runners = ctx.racingRunners;
        const useBucket = runners.length > MAX_NAMED;
        const named = useBucket ? runners.slice(0, MAX_NAMED) : runners;
        const newLabels: string[] = named.map((r) => r.horse);
        if (useBucket) newLabels.push("Any other runner");

        // Replace event_outcomes for this event with runner-based rows.
        await supabase.from("event_outcomes").delete().eq("event_id", event.id);
        const newRows = newLabels.map((label) => ({
          event_id: event.id, external_id: label, label, metadata: null,
        }));
        const { error: rwErr } = await supabase
          .from("event_outcomes")
          .upsert(newRows, { onConflict: "event_id,external_id" });
        if (rwErr) {
          sse.send({ stage: "context", status: "error", message: `racing outcome rewrite failed: ${rwErr.message}` });
          await recordOutcome("failed"); await logSearchQuery({ result_type: "failed", domain: domainId, matched_event_id: event.id }); sse.close(); return;
        }
        const { data: refreshed } = await supabase
          .from("event_outcomes").select("id,label,external_id").eq("event_id", event.id).order("created_at");
        outcomeIdsFinal = refreshed ?? [];
        outcomePairs2 = outcomeIdsFinal.map((o) => ({ id: o.id, label: o.label }));
        sse.send({ stage: "context", status: "info", data: { racing_outcomes_rewritten: outcomePairs2.length } });
      }


      // ----- 5. MODELS -----
      sse.send({ stage: "models", status: "start", data: { models: ["claude", "gpt", "gemini"] } });

      let consensusOut;
      try {
        consensusOut = await runConsensus({
          prompt: ctx.prompt,
          outcomes: outcomePairs2,
          research: ctx.research,
          priors: ctx.priors.length > 0 ? ctx.priors : null,
          marketSignals: ctx.marketSignals.length > 0 ? ctx.marketSignals : null,
          structuredData: ctx.structuredData,
        });
      } catch (e) {
        sse.send({ stage: "models", status: "error", message: (e as Error).message });
        await recordOutcome("failed"); await logSearchQuery({ result_type: "failed", domain: domainId, matched_event_id: event.id }); sse.close(); return;
      }
      sse.send({ stage: "models", status: "done", data: { models_used: consensusOut.consensus.models_used, models_failed: consensusOut.consensus.models_failed } });

      // ----- 6. CONSENSUS -----
      sse.send({ stage: "consensus", status: "start" });
      const labelById = new Map(outcomeIdsFinal.map((o) => [o.id, o.label]));
      const ranked = consensusOut.consensus.ranked_outcomes.map((r) => ({
        ...r,
        outcome_label: labelById.get(r.outcome_id) ?? r.outcome_id,
      }));
      await supabase.from("predictions").update({ is_current: false }).eq("event_id", event.id).eq("mode", "prediction");
      const research_context = ctx.research ?? ctx.researchError;
      const { data: prediction, error: pErr } = await supabase.from("predictions").insert({
        event_id: event.id,
        mode: "prediction",
        ranked_outcomes: ranked.slice(0, 3),
        alternates: ranked.filter((r) => r.is_dark_horse),
        consensus_method: consensusOut.consensus.method,
        consensus_score: consensusOut.consensus.consensus_score,
        agreement_score: consensusOut.consensus.agreement_score,
        model_results: consensusOut.model_results,
        research_context,
        prompt_version: PROMPT_VERSION,
        data_tier: ctx.dataTier,
        data_sources: ctx.dataSources,
        is_current: true,
        expires_at: new Date(Date.now() + PREDICTION_CACHE_TTL_MS).toISOString(),
      }).select("*").single();
      if (pErr) {
        sse.send({ stage: "consensus", status: "error", message: `prediction insert failed: ${pErr.message}` });
        await recordOutcome("failed"); await logSearchQuery({ result_type: "failed", domain: domainId, matched_event_id: event.id }); sse.close(); return;
      }
      sse.send({ stage: "consensus", status: "done", data: { confidence: scoreToConfidence(consensusOut.consensus.agreement_score), data_tier: ctx.dataTier } });

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
