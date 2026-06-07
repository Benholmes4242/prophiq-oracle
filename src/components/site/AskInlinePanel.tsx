import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LoadingNucleus } from "./LoadingNucleus";
import { RotatingTick } from "./RotatingTick";
import { useLoadingStages } from "@/hooks/useLoadingStages";
import { addToHistory } from "@/lib/questionHistory";
import {
  runForecast,
  type AskResult,
  type AskTopic,
  type WireStage,
  type ClarificationPayload,
} from "@/lib/forecast";

export type AskPanelState = "loading" | "result" | "error" | "clarification";

interface AskInlinePanelProps {
  question: string;
  topic: AskTopic;
  onDismiss: () => void;
  onStateChange?: (state: AskPanelState) => void;
  onResubmit?: (newQuestion: string) => void;
}

export function AskInlinePanel({
  question,
  topic,
  onDismiss,
  onStateChange,
  onResubmit,
}: AskInlinePanelProps) {
  const [currentStage, setCurrentStage] = useState<WireStage | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clarification, setClarification] = useState<ClarificationPayload | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyAddedForRef = useRef<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!question) return;
    setCurrentStage(null);
    setResult(null);
    setError(null);
    setClarification(null);
    historyAddedForRef.current = null;

    const abort = new AbortController();
    abortRef.current = abort;

    void runForecast({
      question,
      topic,
      signal: abort.signal,
      onStage: (stage) => setCurrentStage(stage),
      onResult: (res) => {
        setResult(res);
        if (historyAddedForRef.current !== question) {
          historyAddedForRef.current = question;
          addToHistory({
            question,
            eventSlug: res.eventSlug,
            eventDomain: res.eventDomain,
          });
        }
      },
      onClarification: (c) => setClarification(c),
      onError: (msg) => setError(msg),
    });

    return () => abort.abort();
  }, [question, topic]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  useEffect(() => {
    if (result) onStateChange?.("result");
    else if (error) onStateChange?.("error");
    else if (clarification) onStateChange?.("clarification");
    else onStateChange?.("loading");
  }, [result, error, clarification, onStateChange]);



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

      {!result && !error && !clarification && <LoadingBody currentStage={currentStage} />}
      {clarification && (
        <ClarificationBody
          clarification={clarification}
          onPick={(raceNumber: number) => {
            const next = `${question.replace(/\s+$/, "")} race ${raceNumber}`;
            if (onResubmit) onResubmit(next);
            else onDismiss();
          }}
          onDismiss={onDismiss}
        />
      )}
      {result && (
        <ResultBody
          result={result}
          onOpenFull={() =>
            navigate({
              to: "/$domain/events/$slug",
              params: {
                domain: result.eventDomain,
                slug: result.eventSlug,
              },
            })
          }
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

function ResultBody({
  result,
  onOpenFull,
}: {
  result: AskResult;
  onOpenFull: () => void;
}) {
  const pct = Math.round(result.topPickPct);
  return (
    <div className="pt-5">
      <div className="result-stagger mb-2" data-r-stagger="0">
        <div
          className="font-mono text-[10px] tracking-[0.22em]"
          style={{ color: "var(--ink-faint)", fontWeight: 600 }}
        >
          TOP PICK
        </div>
      </div>

      <div
        className="result-stagger flex items-end justify-between gap-3"
        data-r-stagger="1"
      >
        <div className="font-sans text-[26px] font-bold leading-tight flex-1">
          {result.topPickLabel}
        </div>
        <div
          className="font-mono leading-none tracking-tight"
          style={{ color: "var(--amber)", fontWeight: 600, fontSize: 56 }}
        >
          {pct}
          <span style={{ fontSize: 24 }}>%</span>
        </div>
      </div>

      <div
        className="result-stagger mt-4 h-1.5 rounded-full overflow-hidden"
        data-r-stagger="2"
        style={{ background: "var(--line)" }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--amber), var(--amber-2))",
            borderRadius: 999,
            transition: "width 800ms var(--ease-ios)",
          }}
        />
      </div>

      {result.reasoningExcerpt && (
        <p
          className="result-stagger mt-5 font-body text-[14px] leading-[1.5]"
          data-r-stagger="3"
          style={{
            color: "var(--ink-soft)",
            display: "-webkit-box",
            WebkitLineClamp: 10,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {result.reasoningExcerpt}
        </p>
      )}

      <button
        onClick={onOpenFull}
        className="result-stagger transition-ios mt-5 w-full rounded-full py-3.5 font-body text-[15px] font-semibold hover:scale-[1.01]"
        data-r-stagger="4"
        style={{ background: "var(--amber)", color: "white" }}
      >
        Full forecast →
      </button>
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
  clarification: ClarificationPayload;
  onPick: (raceNumber: number) => void;
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
          {clarification.races.map((r) => (
            <button
              key={r.race_number}
              onClick={() => onPick(r.race_number)}
              className="transition-ios flex items-center justify-between rounded-xl px-4 py-3 text-left hover:scale-[1.005]"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border-soft)",
              }}
            >
              <div className="flex flex-col">
                <span className="font-sans text-[15px] font-semibold">
                  Race {r.race_number}
                  {r.local_time ? ` · ${r.local_time}` : ""}
                </span>
                <span
                  className="font-body text-[12px]"
                  style={{ color: "var(--ink-soft)" }}
                >
                  {r.race_type ?? "Race"} · {r.runners} runner{r.runners === 1 ? "" : "s"}
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
          ))}
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
