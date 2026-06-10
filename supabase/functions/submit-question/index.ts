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
import { runResolverTurn, MAX_USER_TURNS } from "../_shared/resolver.ts";
import { stableEventId } from "../_shared/domains/_util.ts";
import { runConsensus } from "../_shared/runConsensus.ts";
import { assembleForecastContext, isGolfRunnersSource } from "../_shared/forecastContext.ts";
import { groundSportEvent } from "../_shared/dataSources/sportGrounding.ts";
import { isDisplayPlaceholder } from "../_shared/placeholderPatterns.ts";
import { writePredictionLineage } from "../_shared/predictionLineage.ts";
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

function readEnv(name: string): string | undefined {
  try {
    return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
      .Deno?.env.get(name);
  } catch {
    return undefined;
  }
}

// Gated behind PROPHIQ_DEBUG_TRACE secret; off in production, set true to
// diagnose sport grounding (decision_sport / grounded_kind etc.).
const DEBUG_TRACE = (readEnv("PROPHIQ_DEBUG_TRACE") ?? "").toLowerCase() === "true";

interface Body {
  question?: string;
  fingerprint?: string;
  // Structured racing follow-up (from the race picker / clarification). When
  // present, the backend canonicalizes the question text from these fields so
  // that downstream parsing is exact and we never round-trip mangled free
  // text. See `prophiq-fix-picker-loop.md`.
  course?: string;
  race_time?: string;
  race_number?: number;
  date_word?: "today" | "tomorrow";
  // Structured golf follow-up (from the tournament picker / clarification).
  // When present, the backend canonicalizes the question text AND threads
  // the exact (tour, tournament_id) onto event.metadata so sportRadarGolf
  // fetches the picked leaderboard directly without name matching.
  tour_alias?: string;
  tournament_id?: string;
  tournament_name?: string;
  // Structured football follow-up (from the fixture picker). When all four
  // are present, the backend skips the resolver and treats the question as
  // a confirmed match: outcomes = [home, "Draw", away], starts_at = kickoff,
  // feed_backed via the football_confirm metadata source.
  football_fixture_id?: string;
  football_home_team?: string;
  football_away_team?: string;
  football_kickoff?: string;
  football_competition?: string;
  // Legacy conversational disambiguation hint. Now optional; the resolver
  // loop handles sport ambiguity natively via the user_turns transcript.
  sport_hint?: string;
  // BACK-COMPAT: prior question text on conversational free-text resubmits.
  // Superseded by `user_turns` (preferred). When both are absent, treated
  // as a fresh single-turn ask.
  original_question?: string;
  // BACK-COMPAT: legacy clarification turn counter. Superseded by
  // `user_turns.length` in the resolver loop.
  clarify_turn?: number;
  // Step 2: the accumulated USER replies across the conversational loop.
  // CRITICAL SECURITY: this is the ONLY conversation state we accept from
  // the client for POLICY decisions. Assistant turns (`turns` below) are
  // mirrored back to the resolver as INERT quoted context only — they never
  // relax policy and never carry instructions.
  user_turns?: unknown;
  // Step 3: alternating transcript (user + assistant) used by the resolver
  // so it can interpret short replies like "yes". Assistant entries are
  // treated as quoted context for reference only.
  turns?: unknown;
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: Body;
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body"); }

  let question = (body.question ?? "").trim();
  const fingerprint = getFingerprint(body, req) ?? null;
  if (!question) return errorResponse("question required");

  // Build the trusted USER-turns transcript (for POLICY) plus the full
  // alternating transcript (for resolver context). Assistant turns are
  // accepted ONLY as inert quoted context for the resolver — they are never
  // included in policy evaluation and are never treated as instructions.
  const rawTurns = Array.isArray(body.user_turns) ? body.user_turns : null;
  let userTurns: string[] = rawTurns
    ? rawTurns
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t.length <= 500)
        .slice(-5)
    : [];

  // Parse the alternating transcript. Cap items, lengths, and roles.
  const rawTranscript = Array.isArray(body.turns) ? body.turns : null;
  type WireTurn = { role: "user" | "assistant"; text: string };
  const transcript: WireTurn[] = rawTranscript
    ? rawTranscript
        .map((t): WireTurn | null => {
          if (!t || typeof t !== "object") return null;
          const rec = t as Record<string, unknown>;
          const role = rec.role === "assistant" ? "assistant" : rec.role === "user" ? "user" : null;
          const text = typeof rec.text === "string" ? rec.text.trim() : "";
          if (!role || !text || text.length > 500) return null;
          return { role, text };
        })
        .filter((t): t is WireTurn => t !== null)
        .slice(-10)
    : [];

  if (userTurns.length === 0) {
    const priorQuestion = typeof body.original_question === "string"
      ? body.original_question.trim()
      : "";
    if (priorQuestion) userTurns.push(priorQuestion);
    userTurns.push(question);
  } else if (userTurns[userTurns.length - 1] !== question) {
    // Frontend should have already pushed the latest reply, but be defensive.
    userTurns.push(question);
    userTurns = userTurns.slice(-5);
  }

  // If the client did not send a transcript (legacy callers / first turn),
  // synthesise a user-only one so the resolver still works.
  const resolverTranscript: WireTurn[] = transcript.length > 0
    ? transcript
    : userTurns.map((text) => ({ role: "user" as const, text }));

  // Re-run POLICY on the combined USER text only. Assistant turns are NEVER
  // included here — a malicious client cannot relax policy by injecting a
  // fake assistant turn. The conversational loop must not become a jailbreak
  // around the policy gate.
  const combinedText = userTurns.join(" ").replace(/\s+/g, " ").trim();
  if (combinedText && combinedText.toLowerCase() !== question.toLowerCase()) {
    question = combinedText;
    console.log(`[submit-question] conversational-resubmit combined -> "${question}"`);
  }
  const clarifyTurn = userTurns.length;

  // Structured racing override: rebuild the question text canonically so the
  // racing parser (and event title) sees a clean string regardless of what
  // the client sent for display.
  const structuredCourse = typeof body.course === "string" ? body.course.trim() : "";
  const structuredTime = typeof body.race_time === "string" ? body.race_time.trim() : "";
  const structuredRaceNo = typeof body.race_number === "number" ? body.race_number : null;
  const structuredDateWord = body.date_word === "today" || body.date_word === "tomorrow"
    ? body.date_word
    : null;
  if (structuredCourse && (structuredTime || structuredRaceNo !== null)) {
    const dateBit = structuredDateWord ? ` ${structuredDateWord}` : "";
    if (structuredTime) {
      question = `who wins the ${structuredTime} at ${structuredCourse}${dateBit}`;
    } else if (structuredRaceNo !== null) {
      question = `who wins race ${structuredRaceNo} at ${structuredCourse}${dateBit}`;
    }
    console.log(`[submit-question] structured-resubmit course=${structuredCourse} time=${structuredTime || "-"} race=${structuredRaceNo ?? "-"} date=${structuredDateWord ?? "-"} -> "${question}"`);
  }

  // Structured golf override: rebuild canonical text from the picker payload.
  // The exact (tour, id) is threaded onto event.metadata further down so
  // sportRadarGolf skips name matching entirely.
  const structuredTourAlias = typeof body.tour_alias === "string" ? body.tour_alias.trim() : "";
  const structuredTournamentId = typeof body.tournament_id === "string" ? body.tournament_id.trim() : "";
  const structuredTournamentName = typeof body.tournament_name === "string" ? body.tournament_name.trim() : "";
  const VALID_GOLF_TOURS = new Set(["pga", "euro", "lpga", "champ", "pgad", "liv"]);
  const TOUR_DISPLAY: Record<string, string> = {
    pga: "PGA Tour", euro: "DP World Tour", lpga: "LPGA Tour",
    champ: "Champions Tour", pgad: "Korn Ferry Tour", liv: "LIV Golf League",
  };
  const hasStructuredGolf =
    VALID_GOLF_TOURS.has(structuredTourAlias) &&
    !!structuredTournamentId &&
    !!structuredTournamentName;
  if (hasStructuredGolf) {
    question = `who wins the ${structuredTournamentName} on the ${TOUR_DISPLAY[structuredTourAlias]}`;
    console.log(`[submit-question] structured-resubmit golf tour=${structuredTourAlias} id=${structuredTournamentId} name="${structuredTournamentName}" -> "${question}"`);
  }

  // Structured football override (fixture picker resubmit). Canonicalises
  // the question text and arms a footballConfirm payload below so the event
  // is feed_backed against the picked fixture without a second resolver hop.
  const structuredFbFixtureId = typeof body.football_fixture_id === "string" ? body.football_fixture_id.trim() : "";
  const structuredFbHome = typeof body.football_home_team === "string" ? body.football_home_team.trim() : "";
  const structuredFbAway = typeof body.football_away_team === "string" ? body.football_away_team.trim() : "";
  const structuredFbKickoff = typeof body.football_kickoff === "string" ? body.football_kickoff.trim() : "";
  const structuredFbCompetition = typeof body.football_competition === "string" ? body.football_competition.trim() : "";
  const hasStructuredFootball = !!structuredFbFixtureId && !!structuredFbHome && !!structuredFbAway;
  if (hasStructuredFootball) {
    question = `who wins ${structuredFbHome} vs ${structuredFbAway}`;
    console.log(`[submit-question] structured-resubmit football fixture=${structuredFbFixtureId} ${structuredFbHome} vs ${structuredFbAway}`);
  }

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

      // Pre-moderation rule-based clarification (racing 2.5, golf 2.7,
      // Stage-1 sport disambig) has been DELETED. The resolver loop after
      // moderation is the single engine that handles disambiguation for
      // every domain. Per-sport confirm steps (findGolfMatches,
      // fetchRacePicker, future football/tennis/...) run only on the
      // resolver's RESOLVE path with a clean canonical event name.
      //
      // The only confident-shortcut paths that still skip the resolver are
      // structured picker resubmits: hasStructuredGolf (the user already
      // tapped a tour) and structured racing fields (course+time / course+
      // race_number) which canonicalise the question above.
      let autoGolfMatch:
        | { tour: string; tournament_id: string; tournament_name: string }
        | null = null;
      // Football confirm result threaded through to event upsert (outcomes,
      // metadata, starts_at, resolves_at). Populated either by the resolver
      // football branch below or by the structured football resubmit shortcut.
      type FootballConfirmThread =
        | {
            kind: "match";
            fixture_id: string;
            home_team: string;
            away_team: string;
            kickoff: string;
            competition: string | null;
          }
        | {
            kind: "league";
            competition: string;
            league_id: number;
            season: number;
            contenders: string[];
            standings_summary: string;
            resolves_at: string;
          };
      let footballConfirm: FootballConfirmThread | null = null;
      if (hasStructuredFootball) {
        footballConfirm = {
          kind: "match",
          fixture_id: structuredFbFixtureId,
          home_team: structuredFbHome,
          away_team: structuredFbAway,
          kickoff: structuredFbKickoff || new Date().toISOString(),
          competition: structuredFbCompetition || null,
        };
      }
      // Tennis match confirm threaded through to event upsert (outcomes,
      // metadata, starts_at). Populated by the resolver tennis branch below.
      type TennisConfirmThread = {
        kind: "match";
        event_id: string;
        player_a: string;
        player_b: string;
        tournament: string | null;
        starts_at: string;
      };
      let tennisConfirm: TennisConfirmThread | null = null;
      // F1 race confirm — when set, outcomes become driver field +
      // "Any other driver" bucket and metadata.f1_race carries the race.
      type F1RaceThread = {
        kind: "race";
        season: number;
        round: number;
        race_name: string;
        circuit: string | null;
        date: string;
        starts_at: string;
        drivers: string[];
      };
      let f1Race: F1RaceThread | null = null;

      // Debug trace — captured into event.metadata._debug_trace only when
      // the PROPHIQ_DEBUG_TRACE secret is set (off in production). Set true
      // to diagnose sport grounding (decision_sport / grounded_kind etc.).
      const debugTrace: {
        decision_sport: string | null;
        sport_kind_for_grounding: string | null;
        skip_for_resubmit: boolean | null;
        grounded_kind: string;
        reached_grounding_gate: boolean;
        grounding_threw: string | null;
      } = {
        decision_sport: null,
        sport_kind_for_grounding: null,
        skip_for_resubmit: null,
        grounded_kind: "GATE_NOT_REACHED",
        reached_grounding_gate: false,
        grounding_threw: null,
      };

      // ----- 3. MODERATION (CLASSIFY + POLICY) -----
      // Step-1 rebuild: the ONLY hard stop is a real policy breach
      // (unsafe/sexual/fraud/private-individual/already-resolved). Every
      // other outcome routes to either an open conversational clarification
      // or the research-grounded forecast floor — never a generic error.
      sse.send({ stage: "moderation", status: "start" });
      const today = new Date();
      const mod = await runModeration(question, today);

      // POLICY (the only terminal that isn't a forecast or a clarification).
      if (mod.policy_breach) {
        const declineMessage = mod.policy_reason ??
          "I can't take that question. Try a different public, future-resolvable event and I'll take another look.";
        sse.send({
          stage: "clarification",
          status: "done",
          data: {
            type: "policy_decline",
            message: declineMessage,
            original_question: question,
          },
        });
        await recordOutcome("rejected_moderation");
        await logSearchQuery({
          result_type: "rejected",
          domain: (mod.domain && tryGetDomain(mod.domain)) ? mod.domain : null,
        });
        sse.close(); return;
      }

      let domainId = mod.domain && tryGetDomain(mod.domain) ? mod.domain : null;

      // Step 2: when moderation is uncertain (no domain or low confidence),
      // hand off to the LLM-driven resolver. The resolver returns one of:
      //   - resolve  : we now know the canonical event; override domain /
      //                normalized / starts_at and continue the pipeline.
      //                The downstream trust layer / placeholder gate /
      //                consensus tiering is UNCHANGED - RESOLVE only means
      //                "I know which event", not "the forecast is confident".
      //   - clarify  : emit a conversational clarification and stop.
      //   - decline  : emit a policy decline and stop (secondary safety net;
      //                the primary policy gate is the moderation POLICY check
      //                above).
      let resolverOverride: { normalized_question: string; starts_at?: string } | null = null;
      if (!domainId || mod.confidence === "low") {
        sse.send({ stage: "resolver", status: "start" });
        const decision = await runResolverTurn(userTurns, today, resolverTranscript);
        sse.send({ stage: "resolver", status: "done", data: { action: decision.action } });

        if (decision.action === "decline") {
          sse.send({
            stage: "clarification",
            status: "done",
            data: {
              type: "policy_decline",
              message: decision.reason,
              original_question: question,
            },
          });
          await recordOutcome("rejected_moderation");
          await logSearchQuery({ result_type: "rejected" });
          sse.close(); return;
        }

        if (decision.action === "clarify") {
          console.log(
            `[submit-question] resolver-clarify turn=${clarifyTurn} -> "${decision.message.slice(0, 80)}"`,
          );
          sse.send({
            stage: "clarification",
            status: "done",
            data: {
              type: "conversational",
              message: decision.message,
              suggestions: [],
              original_question: question,
              user_turns: userTurns,
              clarify_turn: clarifyTurn + 1,
            },
          });
          await logSearchQuery({ result_type: "rejected" });
          sse.close(); return;
        }

        // RESOLVE
        const resolved = tryGetDomain(decision.domain) ? decision.domain : null;
        if (!resolved) {
          sse.send({
            stage: "clarification",
            status: "done",
            data: {
              type: "conversational",
              message: "I'm not sure which event you mean - a name, a date, or a couple of competitors all help me get it right.",
              suggestions: [],
              original_question: question,
              user_turns: userTurns,
              clarify_turn: clarifyTurn + 1,
            },
          });
          sse.close(); return;
        }
        domainId = resolved;
        resolverOverride = {
          normalized_question: decision.canonical_event,
          starts_at: decision.approx_date
            ? new Date(`${decision.approx_date}T12:00:00Z`).toISOString()
            : undefined,
        };
        console.log(
          `[submit-question] resolver-resolve domain=${domainId} sport=${decision.sport ?? "-"} event="${decision.canonical_event}"`,
        );

        // Sport-identity gating: the unified sport grounding module fires
        // whenever the resolver IDENTIFIES the sport, regardless of the
        // domain it guessed. A contest between teams / athletes / nations
        // is ALWAYS a sport event, even if the resolver tagged it
        // politics/markets/entertainment (e.g. "Serbia vs Croatia World
        // Cup"). When grounding fires we force domainId="sport" so the
        // event is stored and displayed as sport. Picker results are
        // mapped back to the existing typed SSE shapes; confirmed results
        // arm footballConfirm / autoGolfMatch / resolverOverride exactly
        // as the old inline branches did so downstream stays unchanged.
        const hasStructuredRacing = !!structuredCourse && (!!structuredTime || structuredRaceNo !== null);
        // Structured picker resubmits identify the sport via picker metadata,
        // not the resolver tag. Backfill decision.sport so the sport is
        // consistent for the trace and any downstream consumer. Does not
        // change grounding (these still ground via their structured-resubmit
        // path).
        if (!decision.sport) {
          if (hasStructuredGolf) decision.sport = "golf";
          else if (hasStructuredRacing) decision.sport = "horse_racing";
          else if (hasStructuredFootball) decision.sport = "football";
        }
        const golfSport = decision.sport === "golf";
        const racingSport = decision.sport === "horse_racing" ||
          decision.sport === "horse racing" ||
          decision.sport === "racing";
        const footballSport = decision.sport === "football" ||
          decision.sport === "soccer" ||
          decision.sport === "association_football";
        const tennisSport = decision.sport === "tennis";
        const f1Sport = decision.sport === "f1" || decision.sport === "formula_1" || decision.sport === "formula1";
        // NOTE: structured golf is NOT in skipForResubmit. groundSportEvent /
        // groundGolf is the ONLY grounding path; skipping it dropped structured
        // golf resubmits to research_grounded. groundGolf now short-circuits on
        // golfHint (tour + tournament_id) so the picker doesn't re-prompt.
        const skipForResubmit =
          (racingSport && hasStructuredRacing) ||
          (footballSport && hasStructuredFootball);

        const sportKindForGrounding: "football" | "golf" | "horse_racing" | "tennis" | "f1" | null =
          footballSport ? "football"
          : golfSport ? "golf"
          : racingSport ? "horse_racing"
          : tennisSport ? "tennis"
          : f1Sport ? "f1"
          : null;

        console.log(`[tennis-trace] sportKind=${sportKindForGrounding} skip=${skipForResubmit}`);
        debugTrace.decision_sport = decision.sport ?? null;
        debugTrace.sport_kind_for_grounding = sportKindForGrounding;
        debugTrace.skip_for_resubmit = skipForResubmit;
        if (sportKindForGrounding && !skipForResubmit) {
          domainId = "sport";
          debugTrace.reached_grounding_gate = true;
          debugTrace.grounded_kind = "GROUNDING_NOT_REACHED";
          try {
            console.log('[tennis-trace] entered grounding block');
            const grounded = await groundSportEvent({
              sport: sportKindForGrounding,
              canonicalEvent: decision.canonical_event,
              approxDate: decision.approx_date ?? null,
              competitors: decision.competitors ?? null,
              golfHint: hasStructuredGolf ? {
                tour: structuredTourAlias,
                tournament_id: structuredTournamentId,
                tournament_name: structuredTournamentName,
              } : null,
            });

            console.log(`[tennis-trace] grounded kind=${grounded.kind}`);
            console.log(`[submit-question] resolver-sport sport=${sportKindForGrounding} kind=${grounded.kind}`);
            debugTrace.grounded_kind = grounded.kind;

            if (grounded.kind === "picker_football") {
              sse.send({
                stage: "clarification",
                status: "done",
                data: {
                  type: "fixture_picker",
                  message: `Those two teams have more than one upcoming fixture. Which match did you mean?`,
                  fixtures: grounded.candidates.map((m) => ({
                    fixture_id: m.fixture_id,
                    home_team: m.home_team,
                    away_team: m.away_team,
                    kickoff: m.kickoff,
                    competition: m.competition,
                    label: `${m.home_team} vs ${m.away_team} - ${m.competition} (${new Date(m.kickoff).toUTCString().slice(0, 16)})`,
                  })),
                },
              });
              sse.close(); return;
            } else if (grounded.kind === "confirmed_match") {
              const m = grounded.metadata.football_confirm;
              footballConfirm = {
                kind: "match",
                fixture_id: m.fixture_id,
                home_team: m.home_team,
                away_team: m.away_team,
                kickoff: m.kickoff,
                competition: m.competition,
              };
              resolverOverride = {
                normalized_question: `${m.home_team} vs ${m.away_team}`,
                starts_at: m.kickoff,
              };
            } else if (grounded.kind === "league") {
              const l = grounded.metadata.football_confirm;
              footballConfirm = {
                kind: "league",
                competition: l.competition,
                league_id: l.league_id,
                season: l.season,
                contenders: l.contenders,
                standings_summary: l.standings_summary,
                resolves_at: l.resolves_at,
              };
              resolverOverride = {
                normalized_question: `${l.competition} ${l.season}-${String((l.season ?? 0) + 1).slice(-2)} winner`,
                starts_at: resolverOverride?.starts_at,
              };
            } else if (grounded.kind === "picker_golf") {
              const fmtRange = (s: string | null, e: string | null): string => {
                if (!s) return "";
                try {
                  const sd = new Date(s);
                  const ed = e ? new Date(e) : null;
                  const mo = sd.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
                  const d1 = sd.getUTCDate();
                  if (ed && ed.getUTCMonth() === sd.getUTCMonth()) return `${mo} ${d1}-${ed.getUTCDate()}`;
                  if (ed) {
                    const mo2 = ed.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
                    return `${mo} ${d1} - ${mo2} ${ed.getUTCDate()}`;
                  }
                  return `${mo} ${d1}`;
                } catch { return ""; }
              };
              const options = grounded.candidates.map((m) => {
                const range = fmtRange(m.start_date, m.end_date);
                const tail = range ? ` (${range})` : "";
                return {
                  tour_alias: m.tour,
                  tour_name: m.tour_name,
                  tournament_id: m.tournament_id,
                  tournament_name: m.tournament_name,
                  start_date: m.start_date,
                  end_date: m.end_date,
                  status: m.status,
                  label: `${m.tournament_name} - ${m.tour_name}${tail}`,
                };
              });
              sse.send({
                stage: "clarification",
                status: "done",
                data: {
                  type: "tournament_picker",
                  message: "That name matches more than one golf tour. Which event did you mean?",
                  options,
                },
              });
              sse.close(); return;
            } else if (grounded.kind === "golf_match") {
              autoGolfMatch = grounded.match;
            } else if (grounded.kind === "racing_confirmed") {
              // Feed-backed single race — bake course+off_time+date_word
              // into normalized_question so the cron-side parser
              // (sport.gatherStructuredSources → groundSportEventForCron)
              // re-finds the same race and emits a racingApi source, keeping
              // the forecast feed_backed end-to-end.
              const race = grounded.race;
              const offTime = race.off_time ?? "";
              let dateWord: "today" | "tomorrow" = "today";
              try {
                const now = new Date();
                const tmr = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
                if (grounded.date === tmr) dateWord = "tomorrow";
              } catch { /* default today */ }
              const canonical = `${race.race_name ? `${race.race_name} — ` : ""}${race.course}${offTime ? ` ${offTime}` : ""} ${dateWord}`.trim();
              resolverOverride = {
                normalized_question: canonical,
                starts_at: race.off_dt ?? resolverOverride?.starts_at,
              };
            } else if (grounded.kind === "picker_racing") {
              const picker = grounded.picker as Extract<typeof grounded.picker, { kind: "races" }>;
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
                  message: picker.pick_by === "race_number"
                    ? `${picker.track_name} is a US track. US races are picked by race number. Which race would you like a forecast for?`
                    : `Which race at ${picker.track_name} would you like a forecast for?`,
                  races: picker.races,
                },
              });
              sse.close(); return;
            } else if (grounded.kind === "tennis_match") {
              const t = grounded.metadata.tennis_confirm;
              tennisConfirm = {
                kind: "match",
                event_id: t.event_id,
                player_a: t.player_a,
                player_b: t.player_b,
                tournament: t.tournament,
                starts_at: t.starts_at,
              };
              resolverOverride = {
                normalized_question: `${t.player_a} vs ${t.player_b}`,
                starts_at: t.starts_at,
              };
            } else if (grounded.kind === "picker_tennis") {
              // Mirror football fixture_picker shape — rare (same two
              // players meeting twice in the window).
              sse.send({
                stage: "clarification",
                status: "done",
                data: {
                  type: "fixture_picker",
                  message: "Those two players have more than one upcoming match. Which one did you mean?",
                  fixtures: grounded.candidates.map((m) => ({
                    fixture_id: m.event_id,
                    home_team: m.player_a,
                    away_team: m.player_b,
                    kickoff: m.starts_at,
                    competition: m.tournament ?? "",
                    label: `${m.player_a} vs ${m.player_b}${m.tournament ? ` - ${m.tournament}` : ""} (${new Date(m.starts_at).toUTCString().slice(0, 16)})`,
                  })),
                },
              });
              sse.close(); return;
            } else if (grounded.kind === "f1_race") {
              const f = grounded.metadata.f1_race;
              f1Race = {
                kind: "race",
                season: f.season,
                round: f.round,
                race_name: f.race_name,
                circuit: f.circuit,
                date: f.date,
                starts_at: f.starts_at,
                drivers: grounded.outcomes,
              };
              resolverOverride = {
                normalized_question: `${f.race_name} ${f.season}`,
                starts_at: f.starts_at,
              };
            }
            // "racing_fallthrough" or "none" -> downstream low_data
            // (horse-racing safety net in forecastContext.ts) or
            // research_grounded (other sports).
          } catch (e) {
            debugTrace.grounding_threw = (e as Error).message;
            debugTrace.grounded_kind = "THREW";
            console.error('[tennis-trace] threw: ' + (e as Error).message);
            console.warn("[submit-question] resolver-sport grounding failed:", (e as Error).message);
          }
        }
      }

      // CLASSIFY/RESOLVE done -> proceed to the forecast pipeline. Low
      // confidence simply means the consensus floor is research_grounded
      // rather than feed_backed; the trust layer downstream still owns
      // tiering, placeholder-gate behaviour, and never-fabricate rules.
      const normalized = resolverOverride?.normalized_question ?? mod.normalized_question ?? question;
      const startsAt = resolverOverride?.starts_at ?? mod.starts_at ?? today.toISOString();
      const resolvesAt = (footballConfirm?.kind === "league" && footballConfirm.resolves_at)
        ? footballConfirm.resolves_at
        : defaultResolvesAt(mod, today);
      sse.send({
        stage: "moderation",
        status: "done",
        data: {
          domain: domainId,
          normalized_question: normalized,
          starts_at: startsAt,
          resolves_at: resolvesAt,
          confidence: mod.confidence,
        },
      });

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
      // Football match winner: outcomes are exactly [Home, Draw, Away] using
      // the REAL team names from the confirmed fixture. All three names pass
      // the placeholder gate. Never collapse to a 2-outcome set - the draw
      // is a real, often-leading outcome.
      // Football league winner: outcomes are the top contenders from the
      // live table (real team names). For a binary "will <team> win the
      // league" question, mod.outcomes (Yes/No) is preserved; the live
      // standings still ground the forecast via the structured-source path.
      let outcomes: string[];
      if (footballConfirm?.kind === "match") {
        outcomes = [footballConfirm.home_team, "Draw", footballConfirm.away_team];
      } else if (
        footballConfirm?.kind === "league" &&
        footballConfirm.contenders.length >= 2 &&
        !(mod.outcomes && mod.outcomes.length === 2 &&
          mod.outcomes.every((o) => /^(yes|no)$/i.test(o.trim())))
      ) {
        outcomes = footballConfirm.contenders;
      } else if (tennisConfirm) {
        // Tennis match winner: exactly two real player names. NO draw.
        outcomes = [tennisConfirm.player_a, tennisConfirm.player_b];
      } else if (f1Race) {
        // F1 race winner: ordered driver field (championship-position
        // first) with a single "Any other driver" bucket tail when the
        // field exceeds MAX_NAMED. Mirrors the racing/golf pattern; the
        // bucket label is gated by isDisplayPlaceholder so it can never
        // headline ranked_outcomes[0] (Gap-1 demotion).
        const MAX_NAMED = 8;
        if (f1Race.drivers.length <= MAX_NAMED) {
          outcomes = [...f1Race.drivers];
        } else {
          outcomes = [...f1Race.drivers.slice(0, MAX_NAMED), "Any other driver"];
        }
      } else {
        outcomes = (mod.outcomes && mod.outcomes.length >= 2) ? mod.outcomes : ["Yes", "No"];
      }

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
        metadata: {
          source: "submit-question",
          ...(hasStructuredGolf ? {
            golf_tour_alias: structuredTourAlias,
            golf_tournament_id: structuredTournamentId,
            golf_tournament_name: structuredTournamentName,
            sub_category: "golf",
          } : autoGolfMatch ? {
            golf_tour_alias: autoGolfMatch.tour,
            golf_tournament_id: autoGolfMatch.tournament_id,
            golf_tournament_name: autoGolfMatch.tournament_name,
            sub_category: "golf",
          } : {}),
          ...(footballConfirm ? {
            sub_category: "football",
            football_confirm: footballConfirm,
          } : {}),
          ...(tennisConfirm ? {
            sub_category: "tennis",
            tennis_confirm: tennisConfirm,
          } : {}),
          ...(f1Race ? {
            sub_category: "f1",
            f1_race: f1Race,
          } : {}),
          ...(DEBUG_TRACE ? { _debug_trace: debugTrace } : {}),
        },
      }, { onConflict: "domain,external_id" }).select("*").single();
      if (evErr || !event) {
        // System/DB failure — emit a distinct stage so the frontend shows a
        // generic "something went wrong" instead of blaming the user with the
        // moderation "be more specific" copy.
        sse.send({ stage: "system", status: "error", message: `event upsert failed: ${evErr?.message}` });
        await recordOutcome("failed"); await logSearchQuery({ result_type: "failed", domain: domainId }); sse.close(); return;
      }

      const outcomeRows = outcomes.map((label) => ({
        event_id: event.id, external_id: label, label, metadata: null,
      }));
      const { error: oErr } = await supabase.from("event_outcomes").upsert(outcomeRows, { onConflict: "event_id,external_id" });
      if (oErr) {
        sse.send({ stage: "system", status: "error", message: `outcome upsert failed: ${oErr.message}` });
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
        const isGolf = isGolfRunnersSource(ctx.structuredSources);
        const MAX_NAMED = 8;
        const runners = ctx.racingRunners;
        const useBucket = runners.length > MAX_NAMED;
        const named = useBucket ? runners.slice(0, MAX_NAMED) : runners;
        const newLabels: string[] = named.map((r) => r.horse);
        if (useBucket) newLabels.push(isGolf ? "Any other player" : "Any other runner");

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

      const timeOfCall = Date.now();
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
      const rankedLabeled = consensusOut.consensus.ranked_outcomes.map((r) => ({
        ...r,
        outcome_label: labelById.get(r.outcome_id) ?? r.outcome_id,
      }));
      // Stable demotion: mirror generate-prediction so a generic bucket /
      // placeholder label (e.g. "Any other player", "Rest of the field")
      // never headlines ranked_outcomes[0] in storage. Probability mass
      // preserved — only ordering changes. Both write paths must agree.
      const realOnly = rankedLabeled.filter((r) => !isDisplayPlaceholder(r.outcome_label));
      const placeholdersOnly = rankedLabeled.filter((r) => isDisplayPlaceholder(r.outcome_label));
      const ranked = realOnly.length > 0
        ? [...realOnly, ...placeholdersOnly].map((r, i) => ({ ...r, rank: i + 1 }))
        : rankedLabeled;
      // Flip prior current rows, then insert the new one. The pair is
      // non-atomic; uniq_current_prediction (partial unique index) is the
      // DB-level guarantee. On collision (concurrent writer), re-flip and
      // retry the insert once.
      const flipPriorPrediction = () =>
        supabase.from("predictions").update({ is_current: false })
          .eq("event_id", event.id).eq("mode", "prediction");
      await flipPriorPrediction();
      const research_context = ctx.research ?? ctx.researchError;
      const insertRow = {
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
      };
      let { data: prediction, error: pErr } = await supabase
        .from("predictions").insert(insertRow).select("*").single();
      if (pErr && (pErr as { code?: string }).code === "23505") {
        console.warn(
          `[submit-question] is_current race detected for event=${event.id}; retrying`,
        );
        await flipPriorPrediction();
        ({ data: prediction, error: pErr } = await supabase
          .from("predictions").insert(insertRow).select("*").single());
      }
      if (pErr) {
        sse.send({ stage: "consensus", status: "error", message: `prediction insert failed: ${pErr.message}` });
        await recordOutcome("failed"); await logSearchQuery({ result_type: "failed", domain: domainId, matched_event_id: event.id }); sse.close(); return;
      }
      sse.send({ stage: "consensus", status: "done", data: { confidence: scoreToConfidence(consensusOut.consensus.agreement_score), data_tier: ctx.dataTier } });

      // prediction_inputs lineage (best-effort; shared with cron path).
      await writePredictionLineage({
        supabase,
        prediction_id: prediction.id,
        event_id: event.id,
        prompt_resolved: ctx.prompt,
        domain: domainId,
        model_results: consensusOut.model_results,
        prompt_version: PROMPT_VERSION,
        time_of_call: timeOfCall,
        research_tokens_used: ctx.research?.tokens_used ?? null,
        priors: ctx.priors.map((p) => ({
          prediction_id: p.prediction_id,
          event_id: p.event_id,
          similarity: p.similarity,
          top_pick_label: p.top_pick_label,
          top_pick_prob: p.top_pick_prob,
          was_correct: p.was_correct,
        })),
        top_pick_prob_raw: ranked[0]?.probability ?? null,
        market_signals: ctx.marketSignals,
        structured_data: ctx.structuredData,
        structured_sources: ctx.structuredSources.sources,
      });

      // ----- 7. DONE -----
      await recordOutcome("accepted");
      await logSearchQuery({
        result_type: wasMatched ? "matched" : "generated",
        domain: domainId,
        matched_event_id: event.id,
      });
      const topOutcome = ranked[0];
      const topProb = topOutcome?.probability ?? 0;
      sse.send({
        stage: "done",
        status: "done",
        data: {
          event_id: event.id,
          prediction_id: prediction.id,
          slug: event.slug,
          domain: domainId,
          top_pick_label: topOutcome?.outcome_label ?? null,
          top_pick_pct: topProb > 1 ? topProb : topProb * 100,
          reasoning_excerpt: topOutcome?.reasons?.[0] ?? null,
          confidence: scoreToConfidence(consensusOut.consensus.agreement_score),
          data_tier: ctx.dataTier,
        },
      });
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
