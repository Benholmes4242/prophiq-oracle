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
  | "research"
  | "models"
  | "consensus";

const KNOWN_STAGES: WireStage[] = [
  "rate_limit",
  "pre_filter",
  "moderation",
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

export interface ClarificationPayload {
  type: "us_race_picker";
  track_name: string;
  date: string;
  message: string;
  races: USRacePickerRace[];
}

interface RunForecastOpts {
  question: string;
  topic: AskTopic;
  signal: AbortSignal;
  onStage?: (stage: WireStage) => void;
  onResult?: (r: AskResult) => void;
  onError?: (message: string) => void;
  onClarification?: (c: ClarificationPayload) => void;
}

export async function runForecast(opts: RunForecastOpts): Promise<void> {
  const { question, topic, signal, onStage, onResult, onError } = opts;
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
            resultPayload = evt.data as { slug?: string; domain?: string };
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

    // Fetch the freshly-created prediction to get the top pick + reasoning.
    try {
      const { supabase } = await import("@/lib/supabase");
      const { data: ev } = await supabase
        .from("events")
        .select("id, slug, domain, question")
        .eq("slug", resultPayload.slug)
        .maybeSingle();
      if (ev) {
        const { data: pred } = await supabase
          .from("v_predictions_public")
          .select("ranked_outcomes, confidence")
          .eq("event_id", ev.id)
          .eq("is_current", true)
          .maybeSingle();
        const top =
          (pred?.ranked_outcomes as Array<{
            outcome_label?: string;
            probability?: number;
            reasons?: string[];
          }> | undefined)?.[0];
        if (top) {
          topLabel = top.outcome_label ?? "—";
          const p = top.probability ?? 0;
          topPct = p > 1 ? p : p * 100;
          reasoningExcerpt = top.reasons?.[0] ?? "";
        }
        if (pred?.confidence) confidence = pred.confidence as ConfidenceTier;
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
