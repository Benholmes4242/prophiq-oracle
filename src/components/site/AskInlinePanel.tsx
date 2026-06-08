import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LoadingNucleus } from "./LoadingNucleus";
import { RotatingTick } from "./RotatingTick";
import { useLoadingStages } from "@/hooks/useLoadingStages";
import { addToHistory } from "@/lib/questionHistory";
import {
  runForecast,
  type AskTopic,
  type WireStage,
  type ClarificationPayload,
  type RacePickerClarification,
  type ConversationalClarification,
  type TournamentPickerClarification,
  type StructuredAsk,
} from "@/lib/forecast";

export type AskPanelState = "loading" | "result" | "error" | "clarification";

interface AskInlinePanelProps {
  question: string;
  topic: AskTopic;
  structured?: StructuredAsk;
  onDismiss: () => void;
  onStateChange?: (state: AskPanelState) => void;
  onResubmit?: (newQuestion: string, structured?: StructuredAsk) => void;
}

export function AskInlinePanel({
  question,
  topic,
  structured,
  onDismiss,
  onStateChange,
  onResubmit,
}: AskInlinePanelProps) {
  const [currentStage, setCurrentStage] = useState<WireStage | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarification, setClarification] = useState<ClarificationPayload | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyAddedForRef = useRef<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!question) return;
    setCurrentStage(null);
    setNavigating(false);
    setError(null);
    setClarification(null);
    historyAddedForRef.current = null;

    const abort = new AbortController();
    abortRef.current = abort;

    void runForecast({
      question,
      topic,
      structured,
      signal: abort.signal,
      onStage: (stage) => setCurrentStage(stage),
      onResult: (res) => {
        setNavigating(true);
        if (historyAddedForRef.current !== question) {
          historyAddedForRef.current = question;
          addToHistory({
            question,
            eventSlug: res.eventSlug,
            eventDomain: res.eventDomain,
          });
        }
        // Skip the inline summary card entirely: route straight to the full
        // forecast page. The full view is the single source of truth.
        navigate({
          to: "/$domain/events/$slug",
          params: { domain: res.eventDomain, slug: res.eventSlug },
        });
      },
      onClarification: (c) => setClarification(c),
      onError: (msg) => setError(msg),
    });

    return () => abort.abort();
  }, [question, topic, structured]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  useEffect(() => {
    if (navigating) onStateChange?.("result");
    else if (error) onStateChange?.("error");
    else if (clarification) onStateChange?.("clarification");
    else onStateChange?.("loading");
  }, [navigating, error, clarification, onStateChange]);



  return (
    <div
      role="region"
      aria-label="Your forecast"
      className="relative"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--amber)",
        borderRadius: 18,
        padding: "22px",
        marginTop: 16,
        marginBottom: 24,
        boxShadow:
          "0 8px 32px rgba(244, 115, 26, 0.12), 0 1px 0 rgba(10, 17, 23, 0.02)",
        animation: "panel-in 380ms var(--ease-ios)",
      }}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss forecast"
        className="absolute grid place-items-center rounded-full"
        style={{
          top: 6,
          right: 6,
          width: 44,
          height: 44,
          color: "var(--ink-soft)",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden
        >
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>

      <div className="pr-10">
        <div
          className="font-mono text-[10px] tracking-[0.22em] mb-1.5"
          style={{ color: "var(--ink-faint)", fontWeight: 600 }}
        >
          YOUR QUESTION
        </div>
        <div className="font-sans text-[20px] font-semibold leading-snug">
          {question}
        </div>
      </div>

      <div
        className="mt-4 border-t"
        style={{ borderColor: "var(--border-soft)" }}
      />

      {!error && !clarification && <LoadingBody currentStage={currentStage} />}
      {clarification && clarification.type === "conversational" && (
        <ConversationalBody
          clarification={clarification}
          priorUserTurns={structured?.user_turns}
          priorAssistantTurns={structured?.assistant_turns}
          currentQuestion={question}
          onReply={(reply, extraStructured) => {
            // Build the new transcript state and forward to the parent.
            // - user_turns: authoritative server-side transcript (the server
            //   re-runs policy on this combined text every turn).
            // - assistant_turns: client-only display history for chat bubbles.
            const priorUser = clarification.user_turns
              ?? structured?.user_turns
              ?? (clarification.original_question ? [clarification.original_question] : [question]);
            const nextUserTurns = [...priorUser, reply].slice(-5);
            const nextAssistantTurns = [
              ...(structured?.assistant_turns ?? []),
              clarification.message,
            ].slice(-5);
            const merged: StructuredAsk = {
              original_question: clarification.original_question,
              clarify_turn: clarification.clarify_turn,
              user_turns: nextUserTurns,
              assistant_turns: nextAssistantTurns,
              ...(extraStructured ?? {}),
            };
            if (onResubmit) onResubmit(reply, merged);
            else onDismiss();
          }}
          onDismiss={onDismiss}
        />
      )}
      {clarification && clarification.type === "tournament_picker" && (
        <TournamentPickerBody
          clarification={clarification}
          onPick={(opt) => {
            const next = `who wins the ${opt.tournament_name} on the ${opt.tour_name}`;
            const struct: StructuredAsk = {
              tour_alias: opt.tour_alias,
              tournament_id: opt.tournament_id,
              tournament_name: opt.tournament_name,
            };
            if (onResubmit) onResubmit(next, struct);
            else onDismiss();
          }}
          onDismiss={onDismiss}
        />
      )}
      {clarification && clarification.type === "policy_decline" && (
        <PolicyDeclineBody
          message={clarification.message}
          onDismiss={onDismiss}
        />
      )}
      {clarification &&
        clarification.type !== "conversational" &&
        clarification.type !== "tournament_picker" &&
        clarification.type !== "policy_decline" && (
        <ClarificationBody
          clarification={clarification}
          onPick={(value: string) => {
            const next = buildResubmittedQuestion(question, clarification, value);
            const struct: StructuredAsk = {
              course: clarification.track_name || undefined,
              date_word: clarification.date_word ?? undefined,
            };
            if (clarification.pick_by === "race_number") {
              const n = parseInt(value, 10);
              if (!Number.isNaN(n)) struct.race_number = n;
            } else {
              struct.race_time = value;
            }
            if (onResubmit) onResubmit(next, struct);
            else onDismiss();
          }}
          onDismiss={onDismiss}
        />
      )}

      {error && <ErrorBody message={error} onDismiss={onDismiss} />}


      <style>{`
        @keyframes panel-in {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes panel-stage-in {
          0%   { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function LoadingBody({ currentStage }: { currentStage: WireStage | null }) {
  const label = useLoadingStages(currentStage);
  return (
    <div className="loading-body">
      <LoadingNucleus />
      <div key={label} className="stage-label-centered">
        {label}
      </div>
      <RotatingTick />
    </div>
  );
}


function ErrorBody({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="pt-5">
      <div className="font-sans text-[16px] font-semibold mb-2">
        Couldn't complete the forecast.
      </div>
      <div
        className="font-body text-[13px]"
        style={{ color: "var(--ink-soft)" }}
      >
        {message}
      </div>
      <button
        onClick={onDismiss}
        className="mt-4 font-body text-[13px] font-semibold underline"
        style={{ color: "var(--amber-strong)" }}
      >
        Close and try again
      </button>
    </div>
  );
}

function ClarificationBody({
  clarification,
  onPick,
  onDismiss,
}: {
  clarification: RacePickerClarification;
  onPick: (value: string) => void;
  onDismiss: () => void;
}) {
  const hasRaces = clarification.races.length > 0;
  return (
    <div className="pt-5">
      <div
        className="font-mono text-[10px] tracking-[0.22em] mb-2"
        style={{ color: "var(--ink-faint)", fontWeight: 600 }}
      >
        PICK A RACE
      </div>
      <div
        className="font-body text-[14px] leading-snug mb-3"
        style={{ color: "var(--ink-soft)" }}
      >
        {clarification.message}
      </div>
      {hasRaces && (
        <div className="flex flex-col gap-2">
          {clarification.races.map((r, idx) => {
            const headline = clarification.pick_by === "time"
              ? (r.local_time ?? r.value)
              : (r.race_number !== null
                  ? `Race ${r.race_number}${r.local_time ? ` · ${r.local_time}` : ""}`
                  : r.label);
            const subParts: string[] = [];
            if (r.race_name) subParts.push(r.race_name);
            if (r.race_class) subParts.push(r.race_class);
            subParts.push(`${r.runners} runner${r.runners === 1 ? "" : "s"}`);
            return (
              <button
                key={`${r.value}-${idx}`}
                onClick={() => onPick(r.value)}
                className="transition-ios flex items-center justify-between rounded-xl px-4 py-3 text-left hover:scale-[1.005]"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border-soft)",
                }}
              >
                <div className="flex flex-col">
                  <span className="font-sans text-[15px] font-semibold">
                    {headline}
                  </span>
                  <span
                    className="font-body text-[12px]"
                    style={{ color: "var(--ink-soft)" }}
                  >
                    {subParts.join(" · ")}
                  </span>
                </div>
                <span
                  className="font-mono text-[18px]"
                  style={{ color: "var(--amber)" }}
                  aria-hidden
                >
                  →
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button
        onClick={onDismiss}
        className="mt-4 font-body text-[13px] font-semibold underline"
        style={{ color: "var(--amber-strong)" }}
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * Build a CLEAN, canonical resubmit question after the user picks a race.
 * We don't mutate the user's original text (which led to garbled strings like
 * "who wins the at Carlisle tomorrow 16:18"). Instead we construct a fresh
 * canonical question from the picked race + known track/date context.
 *
 * - UK/IRE (pick_by="time"):    "who wins the {value} at {track} {dateWord}"
 * - US     (pick_by="race_number"): "who wins race {value} at {track} {dateWord}"
 *
 * dateWord precedence: clarification.date_word (from backend) > parsed from
 * the original question ("today"/"tomorrow") > omitted.
 */
function buildResubmittedQuestion(
  question: string,
  clarification: { pick_by: "race_number" | "time"; track_name: string; date_word: "today" | "tomorrow" | null },
  value: string,
): string {
  const track = (clarification.track_name || "").trim();
  let dateWord: string = clarification.date_word ?? "";
  if (!dateWord) {
    const m = question.toLowerCase().match(/\b(today|tomorrow|tonight)\b/);
    if (m) dateWord = m[1] === "tonight" ? "tonight" : m[1];
  }
  const tail = dateWord ? ` ${dateWord}` : "";
  const at = track ? ` at ${track}` : "";
  if (clarification.pick_by === "race_number") {
    return `who wins race ${value}${at}${tail}`.trim();
  }
  return `who wins the ${value}${at}${tail}`.trim();
}


function ConversationalBody({
  clarification,
  onReply,
  onDismiss,
}: {
  clarification: ConversationalClarification;
  onReply: (reply: string, structured?: StructuredAsk) => void;
  onDismiss: () => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="pt-5">
      <div
        className="font-mono text-[10px] tracking-[0.22em] mb-2"
        style={{ color: "var(--ink-faint)", fontWeight: 600 }}
      >
        I NEED A LITTLE MORE
      </div>
      <div
        className="font-body text-[15px] leading-snug mb-4"
        style={{ color: "var(--ink)" }}
      >
        {clarification.message}
      </div>

      {clarification.suggestions.length > 0 && (
        <div className="flex flex-col gap-2 mb-3">
          {clarification.suggestions.map((s, i) => (
            <button
              key={`${s.reply}-${i}`}
              onClick={() => onReply(s.reply, s.structured as StructuredAsk | undefined)}
              className="transition-ios flex items-center justify-between rounded-xl px-4 py-3 text-left hover:scale-[1.005]"
              style={{ background: "var(--bg)", border: "1px solid var(--border-soft)" }}
            >
              <span className="font-sans text-[14px] font-semibold">{s.label}</span>
              <span className="font-mono text-[18px]" style={{ color: "var(--amber)" }} aria-hidden>→</span>
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = draft.trim();
          if (v) onReply(v);
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Reply with the missing detail…"
          className="flex-1 rounded-full px-4 py-2.5 font-body text-[14px] outline-none"
          style={{ background: "var(--bg)", border: "1px solid var(--border-soft)", color: "var(--ink)" }}
          autoFocus
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="transition-ios rounded-full px-4 py-2.5 font-body text-[14px] font-semibold disabled:opacity-50"
          style={{ background: "var(--amber)", color: "white" }}
        >
          Send
        </button>
      </form>

      <button
        onClick={onDismiss}
        className="mt-4 font-body text-[13px] font-semibold underline"
        style={{ color: "var(--amber-strong)" }}
      >
        Cancel
      </button>
    </div>
  );
}

function PolicyDeclineBody({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="pt-5">
      <div
        className="font-mono text-[10px] tracking-[0.22em] mb-2"
        style={{ color: "var(--ink-faint)", fontWeight: 600 }}
      >
        I CAN'T TAKE THAT ONE
      </div>
      <div
        className="font-body text-[15px] leading-snug mb-4"
        style={{ color: "var(--ink)" }}
      >
        {message}
      </div>
      <button
        onClick={onDismiss}
        className="transition-ios rounded-full px-4 py-2.5 font-body text-[14px] font-semibold"
        style={{ background: "var(--amber)", color: "white" }}
      >
        OK
      </button>
    </div>
  );
}

function TournamentPickerBody({
  clarification,
  onPick,
  onDismiss,
}: {
  clarification: TournamentPickerClarification;
  onPick: (opt: TournamentPickerClarification["options"][number]) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="pt-5">
      <div
        className="font-mono text-[10px] tracking-[0.22em] mb-2"
        style={{ color: "var(--ink-faint)", fontWeight: 600 }}
      >
        PICK A TOURNAMENT
      </div>
      <div
        className="font-body text-[14px] leading-snug mb-3"
        style={{ color: "var(--ink-soft)" }}
      >
        {clarification.message}
      </div>
      <div className="flex flex-col gap-2">
        {clarification.options.map((o) => {
          const fmtRange = (s: string | null, e: string | null) => {
            if (!s) return "";
            try {
              const sd = new Date(s);
              const ed = e ? new Date(e) : null;
              const mo = sd.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
              const d1 = sd.getUTCDate();
              if (ed && ed.getUTCMonth() === sd.getUTCMonth()) {
                return `${mo} ${d1}–${ed.getUTCDate()}`;
              }
              if (ed) {
                const mo2 = ed.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
                return `${mo} ${d1} – ${mo2} ${ed.getUTCDate()}`;
              }
              return `${mo} ${d1}`;
            } catch {
              return "";
            }
          };
          const range = fmtRange(o.start_date, o.end_date);
          const subParts: string[] = [];
          if (range) subParts.push(range);
          if (o.status) subParts.push(o.status);
          return (
            <button
              key={`${o.tour_alias}-${o.tournament_id}`}
              onClick={() => onPick(o)}
              className="transition-ios flex items-center justify-between rounded-xl px-4 py-3 text-left hover:scale-[1.005]"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border-soft)",
              }}
            >
              <div className="flex flex-col">
                <span className="font-sans text-[15px] font-semibold">
                  {o.tournament_name}
                </span>
                <span
                  className="font-body text-[12px]"
                  style={{ color: "var(--ink-soft)" }}
                >
                  {o.tour_name}
                  {subParts.length > 0 ? ` · ${subParts.join(" · ")}` : ""}
                </span>
              </div>
              <span
                className="font-mono text-[18px]"
                style={{ color: "var(--amber)" }}
                aria-hidden
              >
                →
              </span>
            </button>
          );
        })}
      </div>
      <button
        onClick={onDismiss}
        className="mt-4 font-body text-[13px] font-semibold underline"
        style={{ color: "var(--amber-strong)" }}
      >
        Cancel
      </button>
    </div>
  );
}
