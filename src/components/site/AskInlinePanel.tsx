import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LoadingNucleus } from "./LoadingNucleus";
import { RotatingTick } from "./RotatingTick";
import { useLoadingStages } from "@/hooks/useLoadingStages";
import { addToHistory, updateHistory } from "@/lib/questionHistory";
import {
  runForecast,
  type AskResult,
  type AskTopic,
  type WireStage,
} from "@/lib/forecast";

export type AskPanelState = "loading" | "result" | "error";

interface AskInlinePanelProps {
  question: string;
  topic: AskTopic;
  onDismiss: () => void;
  onStateChange?: (state: AskPanelState) => void;
}

export function AskInlinePanel({
  question,
  topic,
  onDismiss,
  onStateChange,
}: AskInlinePanelProps) {
  const [currentStage, setCurrentStage] = useState<WireStage | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!question) return;
    setCurrentStage(null);
    setResult(null);
    setError(null);

    const historyEntry = addToHistory({ question });
    const abort = new AbortController();
    abortRef.current = abort;

    void runForecast({
      question,
      topic,
      signal: abort.signal,
      onStage: (stage) => setCurrentStage(stage),
      onResult: (res) => {
        setResult(res);
        updateHistory(historyEntry.id, {
          eventSlug: res.eventSlug,
          eventDomain: res.eventDomain,
        });
      },
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
    else onStateChange?.("loading");
  }, [result, error, onStateChange]);


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

      {!result && !error && <LoadingBody currentStage={currentStage} />}
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
        Full prediction →
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
