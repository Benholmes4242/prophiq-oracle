// SubQuestionCard — renders one binary sub-question under a parent event's
// "Other forecasts on this event" section. Phase C scope per Brief FF v2:
// side-question eyebrow + question + confidence pill + updated-at timestamp.
// Odds display, format picker, frequentist framing, and visual cues are
// deliberately deferred to Phase D.

import { ConfidenceLabel } from "@/components/site/ConfidenceLabel";
import type { EventRow, PredictionRow } from "@/lib/types";

interface Props {
  event: EventRow;
  prediction: PredictionRow | null;
}

export function SubQuestionCard({ event, prediction }: Props) {
  const top = prediction?.ranked_outcomes?.[0] ?? null;
  const updatedAt = prediction?.generated_at ?? null;

  return (
    <article
      className="rounded-xl p-4"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-soft)",
      }}
    >
      <div
        className="font-mono text-[9.5px] font-bold tracking-[0.2em]"
        style={{ color: "var(--ink-soft)" }}
      >
        SIDE QUESTION
      </div>

      <h3
        className="mt-2 font-sans text-base leading-snug tracking-tight"
        style={{ fontWeight: 600, color: "var(--ink)" }}
      >
        {event.question || event.title}
      </h3>

      <div className="mt-3 flex items-center justify-between gap-3">
        {prediction ? (
          <ConfidenceLabel tier={prediction.confidence} />
        ) : (
          <span
            className="font-mono text-[9.5px] font-bold tracking-[0.2em]"
            style={{ color: "var(--ink-soft)" }}
          >
            PENDING
          </span>
        )}
        {updatedAt && (
          <span
            className="font-mono text-[10px]"
            style={{ color: "var(--ink-soft)" }}
            suppressHydrationWarning
          >
            Updated {formatUpdated(updatedAt)}
          </span>
        )}
      </div>

      {top?.outcome_label && (
        <div
          className="mt-2 font-body text-xs"
          style={{ color: "var(--ink-soft)" }}
        >
          Lean: <span style={{ color: "var(--ink)" }}>{top.outcome_label}</span>
        </div>
      )}
    </article>
  );
}

function formatUpdated(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMin = Math.max(0, Math.floor((now - d.getTime()) / 60_000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
