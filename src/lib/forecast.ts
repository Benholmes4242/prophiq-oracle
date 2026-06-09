// SSE consumer for the submit-question edge function. Translates the
// wire-protocol stages into a small, brand-safe shape the AskSheet renders.

import { getBrowserFingerprint } from "@/hooks/useBrowserFingerprint";
import type { ConfidenceTier } from "@/lib/types";
import { showPaywall, type PaywallQuotaInfo } from "@/components/paywall/PaywallModal";
import { supabase } from "@/lib/supabase";

export type AskTopic = "any" | "sport" | "politics" | "markets" | "entertainment";

export type WireStage =
  | "rate_limit"
  | "pre_filter"
  | "moderation"
  | "resolver"
  | "research"
  | "models"
  | "consensus";

const KNOWN_STAGES: WireStage[] = [
  "rate_limit",
  "pre_filter",
  "moderation",
  "resolver",
  "research",
  "models",
  "consensus",
];

export interface AskResult {
  eventSlug: string;
  eventDomain: string;
  question: string;
  topPickLabel: string;
  topPickPct: number;
  confidence: ConfidenceTier;
  reasoningExcerpt: string;
}

export interface USRacePickerRace {
  race_number: number;
  local_time: string | null;
  runners: number;
  race_type: string | null;
}

export interface PickerRace {
  /** Value to inject back into the question. US: race number string. UK/IRE: off-time HH:MM. */
  value: string;
  /** Pre-formatted display label. */
  label: string;
  local_time: string | null;
  runners: number;
  race_name: string | null;
  race_class: string | null;
  race_number: number | null;
}

export type PickBy = "race_number" | "time";

export interface RacePickerClarification {
  /** New: "race_picker". Back-compat: "us_race_picker". */
  type: "race_picker" | "us_race_picker";
  pick_by: PickBy;
  track_name: string;
  date: string;
  /** "today" | "tomorrow" | null — backend-computed relative to UTC now. */
  date_word: "today" | "tomorrow" | null;
  message: string;
  races: PickerRace[];
}

export interface ConversationalSuggestion {
  label: string;
  reply: string;
  /** Optional structured payload merged into the resubmit body (e.g. sport_hint). */
  structured?: Partial<StructuredAsk>;
}

export interface TranscriptTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ConversationalClarification {
  type: "conversational";
  message: string;
  suggestions: ConversationalSuggestion[];
  original_question: string;
  /** Loop counter echoed back on resubmit so the backend can cap clarifying turns. */
  clarify_turn?: number;
  /** Authoritative user turns echoed back by the server (resolver transcript). */
  user_turns?: string[];
}

export interface TournamentPickerOption {
  tour_alias: string;
  tour_name: string;
  tournament_id: string;
  tournament_name: string;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  label: string;
}

export interface TournamentPickerClarification {
  type: "tournament_picker";
  message: string;
  options: TournamentPickerOption[];
}

export interface PolicyDeclineClarification {
  type: "policy_decline";
  message: string;
  original_question: string;
}

export type ClarificationPayload =
  | RacePickerClarification
  | ConversationalClarification
  | TournamentPickerClarification
  | PolicyDeclineClarification;


export interface StructuredAsk {
  course?: string;
  race_time?: string;
  race_number?: number;
  date_word?: "today" | "tomorrow";
  // Golf tournament picker resubmit fields.
  tour_alias?: string;
  tournament_id?: string;
  tournament_name?: string;
  /** Conversational domain disambiguation (Stage 1) — e.g. "golf", "tennis". */
  sport_hint?: string;
  /** Prior question text, sent on conversational free-text resubmits so the
   *  backend re-runs sport/signal detection on the combined context. */
  original_question?: string;
  /** Loop guard echoed back to the backend on each conversational resubmit. */
  clarify_turn?: number;
  /** Step 2: accumulated USER turns sent to the resolver. Trusted by server. */
  user_turns?: string[];
  /** Step 2: accumulated ASSISTANT turns (client-only, for chat-bubble UI).
   *  Server ignores this field for policy decisions, but mirrors it into the
   *  resolver transcript as quoted context only (never as instructions). */
  assistant_turns?: string[];
  /** Step 3: alternating transcript sent to the resolver so it can interpret
   *  short replies like "yes". Server treats assistant entries as INERT
   *  quoted context only — they never relax policy. */
  turns?: TranscriptTurn[];
}

interface RunForecastOpts {
  question: string;
  topic: AskTopic;
  signal: AbortSignal;
  structured?: StructuredAsk;
  onStage?: (stage: WireStage) => void;
  onResult?: (r: AskResult) => void;
  onError?: (message: string) => void;
  onClarification?: (c: ClarificationPayload) => void;
}

export async function runForecast(opts: RunForecastOpts): Promise<void> {
  const { question, topic, structured, signal, onStage, onResult, onError, onClarification } = opts;
  try {
    const fingerprint = await getBrowserFingerprint();
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-question`;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    // The ask box is gated on auth (Option C) — a real user session must exist.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      onError?.("Please sign in to get a forecast.");
      return;
    }
    const bearer = session.access_token;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
        apikey: anon,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        question,
        suggested_domain: topic === "any" ? null : topic,
        fingerprint,
        ...(structured ?? {}),
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      if (res.status === 429) {
        // Try to surface tier-aware paywall using the 429 body (Brief CC).
        const body = await res.json().catch(() => null) as
          | (PaywallQuotaInfo & { error?: string })
          | null;
        if (body && typeof body.daily_cap === "number") {
          showPaywall({
            daily_cap: body.daily_cap,
            used_today: body.used_today ?? 0,
            tier: body.tier ?? "free",
            is_trialing: !!body.is_trialing,
            trial_end: body.trial_end ?? null,
          });
          onError?.(body.error ?? "Daily forecast limit reached.");
        } else {
          onError?.("You've hit the submission limit. Try again later.");
        }
      } else {
        onError?.(`Request failed (${res.status}). Please try again.`);
      }
      return;
    }

    onStage?.("rate_limit");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let resultPayload: {
      slug?: string;
      domain?: string;
    } | null = null;
    let confidence: ConfidenceTier = "mixed";
    let topLabel = "";
    let topPct = 0;
    let reasoningExcerpt = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = raw.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let evt: {
          stage: string;
          status: "start" | "progress" | "done" | "error";
          message?: string;
          data?: Record<string, unknown>;
        };
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }

        if (evt.status === "start") {
          if (KNOWN_STAGES.includes(evt.stage as WireStage)) {
            onStage?.(evt.stage as WireStage);
          }
        } else if (evt.status === "done") {
          if (evt.stage === "consensus" && evt.data) {
            const c = (evt.data as { confidence?: ConfidenceTier }).confidence;
            if (c) confidence = c;
          }
          if (evt.stage === "done" && evt.data) {
            const d = evt.data as {
              slug?: string;
              domain?: string;
              top_pick_label?: string | null;
              top_pick_pct?: number | null;
              reasoning_excerpt?: string | null;
              confidence?: ConfidenceTier | null;
            };
            resultPayload = { slug: d.slug, domain: d.domain };
            if (d.top_pick_label) {
              topLabel = d.top_pick_label;
              topPct = typeof d.top_pick_pct === "number" ? d.top_pick_pct : 0;
              reasoningExcerpt = d.reasoning_excerpt ?? "";
              if (d.confidence) confidence = d.confidence;
            }
          }
          if (evt.stage === "clarification" && evt.data) {
            onClarification?.(normaliseClarification(evt.data));
            return;
          }

        } else if (evt.status === "error") {
          // Daily-limit hits arrive as an SSE rate_limit error (HTTP 200) with
          // tier/quota context in evt.data — route to the paywall, not generic
          // onError.
          if (evt.stage === "rate_limit") {
            const d = (evt.data ?? {}) as Partial<PaywallQuotaInfo> & {
              code?: string;
            };
            if (
              d.code === "DAILY_LIMIT_REACHED" &&
              typeof d.daily_cap === "number"
            ) {
              showPaywall({
                daily_cap: d.daily_cap,
                used_today: d.used_today ?? 0,
                tier: d.tier ?? "free",
                is_trialing: !!d.is_trialing,
                trial_end: d.trial_end ?? null,
              });
              onError?.(
                evt.message ?? "You've reached today's submission limit.",
              );
              return;
            }
          }
          const map: Record<string, string> = {
            moderation:
              "We couldn't answer that. Try a more specific public-event question.",
            pre_filter:
              "We couldn't answer that. Try a more specific public-event question.",
            system:
              "Something went wrong on our side. Please try again in a moment.",
            context:
              "Something went wrong on our side. Please try again in a moment.",
            models:
              "Something went wrong on our side. Please try again in a moment.",
            consensus:
              "Something went wrong on our side. Please try again in a moment.",
            rate_limit:
              evt.message ?? "You've reached today's submission limit.",
          };
          onError?.(map[evt.stage] ?? evt.message ?? "Something went wrong.");
          return;
        }
      }
    }

    if (!resultPayload?.slug || !resultPayload?.domain) {
      onError?.("Forecast generated but couldn't be opened. Refresh to view.");
      return;
    }

    // Fallback: if the SSE done payload didn't include top_pick_label (older
    // backend), poll the freshly-created prediction. Skipped when we already
    // have the top pick from the stream.
    if (!topLabel) try {
      const { supabase } = await import("@/lib/supabase");
      const { data: ev } = await supabase
        .from("events")
        .select("id, slug, domain, question")
        .eq("slug", resultPayload.slug)
        .maybeSingle();
      if (ev) {
        let top:
          | { outcome_label?: string; probability?: number; reasons?: string[] }
          | undefined;
        for (let attempt = 0; attempt < 8; attempt++) {
          const { data: pred } = await supabase
            .from("v_predictions_public")
            .select("ranked_outcomes, confidence, generated_at")
            .eq("event_id", ev.id)
            .eq("is_current", true)
            .order("generated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const candidate = (pred?.ranked_outcomes as Array<{
            outcome_label?: string;
            probability?: number;
            reasons?: string[];
          }> | undefined)?.[0];
          if (candidate?.outcome_label) {
            top = candidate;
            if (pred?.confidence) confidence = pred.confidence as ConfidenceTier;
            break;
          }
          await new Promise((r) => setTimeout(r, 450));
        }
        if (top) {
          topLabel = top.outcome_label ?? "-";
          const p = top.probability ?? 0;
          topPct = p > 1 ? p : p * 100;
          reasoningExcerpt = top.reasons?.[0] ?? "";
        }
      }

    } catch {
      /* swallow; we still surface the slug/domain via Open full view */
    }

    onResult?.({
      eventSlug: resultPayload.slug,
      eventDomain: resultPayload.domain,
      question,
      topPickLabel: topLabel || "See full forecast",
      topPickPct: topPct,
      confidence,
      reasoningExcerpt:
        reasoningExcerpt ||
        "Open the full view for the reasoning and the rest of the field.",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    onError?.("Network error. Please try again.");
  }
}

/**
 * Normalises an SSE clarification payload into the new generic shape.
 * Accepts both `type: "race_picker"` (current) and the legacy
 * `type: "us_race_picker"` payload from earlier deploys.
 */
function normaliseClarification(data: Record<string, unknown>): ClarificationPayload {
  const type = (data.type as string) ?? "race_picker";

  if (type === "conversational") {
    const rawSuggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    const suggestions: ConversationalSuggestion[] = rawSuggestions
      .map((s) => {
        const rec = s as Record<string, unknown>;
        const label = typeof rec.label === "string" ? rec.label : "";
        const reply = typeof rec.reply === "string" ? rec.reply : "";
        const structured = rec.structured && typeof rec.structured === "object"
          ? (rec.structured as Partial<StructuredAsk>)
          : undefined;
        return { label, reply, structured };
      })
      .filter((s) => s.label && s.reply);
    const rawUserTurns = Array.isArray(data.user_turns) ? data.user_turns : null;
    const userTurns = rawUserTurns
      ? rawUserTurns.filter((t): t is string => typeof t === "string")
      : undefined;
    return {
      type: "conversational",
      message: (data.message as string) ?? "Could you tell me a bit more?",
      suggestions,
      original_question: (data.original_question as string) ?? "",
      clarify_turn: typeof data.clarify_turn === "number" ? data.clarify_turn : undefined,
      user_turns: userTurns,
    };
  }

  if (type === "policy_decline") {
    return {
      type: "policy_decline",
      message: (data.message as string) ?? "I can't take that question.",
      original_question: (data.original_question as string) ?? "",
    };
  }


  if (type === "tournament_picker") {
    const rawOptions = Array.isArray(data.options) ? data.options : [];
    const options: TournamentPickerOption[] = rawOptions
      .map((o) => {
        const rec = o as Record<string, unknown>;
        return {
          tour_alias: typeof rec.tour_alias === "string" ? rec.tour_alias : "",
          tour_name: typeof rec.tour_name === "string" ? rec.tour_name : "",
          tournament_id: typeof rec.tournament_id === "string" ? rec.tournament_id : "",
          tournament_name: typeof rec.tournament_name === "string" ? rec.tournament_name : "",
          start_date: typeof rec.start_date === "string" ? rec.start_date : null,
          end_date: typeof rec.end_date === "string" ? rec.end_date : null,
          status: typeof rec.status === "string" ? rec.status : null,
          label: typeof rec.label === "string"
            ? rec.label
            : `${String(rec.tournament_name ?? "")} - ${String(rec.tour_name ?? "")}`,
        };
      })
      .filter((o) => o.tour_alias && o.tournament_id && o.tournament_name);
    return {
      type: "tournament_picker",
      message: (data.message as string) ?? "Which event did you mean?",
      options,
    };
  }

  const pick_by: PickBy = (data.pick_by as PickBy) ?? "race_number";
  const rawRaces = Array.isArray(data.races) ? data.races : [];
  const races: PickerRace[] = rawRaces.map((r) => {
    const rec = r as Record<string, unknown>;
    if (typeof rec.value === "string" && typeof rec.label === "string") {
      return {
        value: rec.value,
        label: rec.label,
        local_time: (rec.local_time as string | null) ?? null,
        runners: (rec.runners as number) ?? 0,
        race_name: (rec.race_name as string | null) ?? null,
        race_class: (rec.race_class as string | null) ?? null,
        race_number: (rec.race_number as number | null) ?? null,
      };
    }
    const num = (rec.race_number as number) ?? 0;
    const localTime = (rec.local_time as string | null) ?? null;
    const runners = (rec.runners as number) ?? 0;
    const raceType = (rec.race_type as string | null) ?? null;
    const parens: string[] = [];
    if (raceType) parens.push(raceType);
    if (runners > 0) parens.push(`${runners} runner${runners === 1 ? "" : "s"}`);
    const tail = parens.length ? ` (${parens.join(", ")})` : "";
    const timeBit = localTime ? ` · ${localTime}` : "";
    return {
      value: String(num),
      label: `Race ${num}${timeBit}${tail}`,
      local_time: localTime,
      runners,
      race_name: null,
      race_class: raceType,
      race_number: num,
    };
  });
  return {
    type: (type === "us_race_picker" ? "us_race_picker" : "race_picker"),
    pick_by,
    track_name: (data.track_name as string) ?? "",
    date: (data.date as string) ?? "",
    date_word: (data.date_word as "today" | "tomorrow" | null) ?? null,
    message: (data.message as string) ?? "",
    races,
  };
}

