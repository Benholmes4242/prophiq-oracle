import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ConfidenceLabel } from "./ConfidenceLabel";
import { addToHistory, updateHistory } from "@/lib/questionHistory";
import {
  runForecast,
  ASK_STAGES,
  type AskStageId,
  type AskResult,
  type AskTopic,
} from "@/lib/forecast";

interface AskSheetProps {
  open: boolean;
  question: string;
  topic: AskTopic;
  onClose: () => void;
}

export function AskSheet({ open, question, topic, onClose }: AskSheetProps) {
  const [stageIdx, setStageIdx] = useState(0);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open || !question) return;
    setStageIdx(0);
    setResult(null);
    setError(null);

    const historyEntry = addToHistory({ question });
    const abort = new AbortController();
    abortRef.current = abort;

    void runForecast({
      question,
      topic,
      signal: abort.signal,
      onStage: (id: AskStageId) => {
        const i = ASK_STAGES.findIndex((s) => s.id === id);
        if (i >= 0) setStageIdx(i);
      },
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
  }, [open, question, topic]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) {
      window.addEventListener("keydown", onKey);
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        window.removeEventListener("keydown", onKey);
        document.body.style.overflow = prev;
      };
    }
  }, [open, onClose]);

  // Swipe-down to close (touch only)
  const touchStartY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  if (!open) return null;

  const progressPct = result
    ? 100
    : Math.min(((stageIdx + 1) / (ASK_STAGES.length + 1)) * 100, 95);

  return (
    <div
      className="fixed inset-0 z-[1000]"
      style={{
        background: "rgba(11, 18, 32, 0.4)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        animation: "ask-backdrop-in 280ms ease-out",
      }}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ask Prophiq"
        className="absolute left-0 right-0 bottom-0 mx-auto"
        style={{
          maxWidth: 600,
          maxHeight: "90vh",
          background: "var(--bg-card)",
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          animation: "ask-sheet-in 360ms cubic-bezier(0.32, 0.72, 0, 1)",
          overflow: "auto",
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragY ? undefined : "transform 240ms cubic-bezier(0.32, 0.72, 0, 1)",
          boxShadow: "0 -20px 60px -20px rgba(11,18,32,0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          touchStartY.current = e.touches[0]?.clientY ?? null;
        }}
        onTouchMove={(e) => {
          if (touchStartY.current == null) return;
          const dy = (e.touches[0]?.clientY ?? 0) - touchStartY.current;
          if (dy > 0) setDragY(dy);
        }}
        onTouchEnd={() => {
          if (dragY > 120) {
            onClose();
          }
          setDragY(0);
          touchStartY.current = null;
        }}
      >
        {/* Grab handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              background: "var(--border-strong)",
            }}
          />
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 grid h-10 w-10 place-items-center rounded-full"
          style={{ color: "var(--ink-soft)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>

        <div className="px-6 pt-2 pb-7">
          {/* Question echo */}
          <div className="mb-5">
            <div
              className="font-mono text-[10px] tracking-[0.22em] mb-1.5"
              style={{ color: "var(--ink-faint)", fontWeight: 600 }}
            >
              YOUR QUESTION
            </div>
            <div className="font-display text-[20px] font-semibold leading-snug">
              {question}
            </div>
          </div>

          <div
            className="border-t"
            style={{ borderColor: "var(--border-soft)" }}
          />

          {!result && !error && <LoadingBody stageIdx={stageIdx} />}
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
          {error && <ErrorBody message={error} onClose={onClose} />}

          {!result && !error && (
            <div
              className="mt-6 h-[3px] rounded-full overflow-hidden"
              style={{ background: "var(--border-soft)" }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progressPct}%`,
                  background: "var(--amber)",
                  borderRadius: 999,
                  transition: "width 400ms ease-out",
                }}
              />
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes ask-sheet-in {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes ask-backdrop-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes ask-breathe {
          0%, 100% { opacity: 0.4; }
          50%      { opacity: 1.0; }
        }
        @keyframes ask-stage-in {
          0%   { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes ask-result-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function LoadingBody({ stageIdx }: { stageIdx: number }) {
  const label = ASK_STAGES[stageIdx]?.label ?? "Calibrating";
  return (
    <div className="pt-6 min-h-[120px]">
      <div className="flex items-center gap-2.5">
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--amber)",
            animation: "ask-breathe 1.4s ease-in-out infinite",
          }}
        />
        <div
          key={label}
          className="font-display text-[18px] font-semibold"
          style={{ animation: "ask-stage-in 400ms ease-in-out" }}
        >
          {label}
        </div>
      </div>
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
    <div className="pt-6" style={{ animation: "ask-result-in 400ms ease-out" }}>
      <div className="flex items-start justify-between mb-2">
        <div
          className="font-mono text-[10px] tracking-[0.22em]"
          style={{ color: "var(--ink-faint)", fontWeight: 600 }}
        >
          TOP PICK
        </div>
        <ConfidenceLabel tier={result.confidence} />
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="font-display text-[26px] font-bold leading-tight flex-1">
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
        className="mt-4 h-1.5 rounded-full overflow-hidden"
        style={{ background: "var(--border-soft)" }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "var(--amber)",
            borderRadius: 999,
          }}
        />
      </div>
      {result.reasoningExcerpt && (
        <p
          className="mt-5 font-body text-[14px] leading-[1.5]"
          style={{ color: "var(--ink-soft)" }}
        >
          {result.reasoningExcerpt}
        </p>
      )}
      <button
        onClick={onOpenFull}
        className="mt-6 w-full rounded-full py-3.5 font-body text-[15px] font-semibold transition-transform hover:scale-[1.01]"
        style={{ background: "var(--amber)", color: "white" }}
      >
        Open full view →
      </button>
    </div>
  );
}

function ErrorBody({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="pt-6">
      <div className="font-display text-[16px] font-semibold mb-2">
        Couldn't complete the forecast.
      </div>
      <div className="font-body text-[13px]" style={{ color: "var(--ink-soft)" }}>
        {message}
      </div>
      <button
        onClick={onClose}
        className="mt-4 font-body text-[13px] font-semibold underline"
        style={{ color: "var(--amber-strong)" }}
      >
        Close and try again
      </button>
    </div>
  );
}
