// SubQuestionCard — renders one binary sub-question under a parent event's
// "Other forecasts on this event" section. Brief FF v2 Phase D adds odds
// display (where the domain doesn't disable it) and the shared
// UpdatedTimestamp pill.

import { ConfidenceLabel } from "@/components/site/ConfidenceLabel";
import { OddsDisplay } from "@/components/site/OddsDisplay";
import { UpdatedTimestamp } from "@/components/site/UpdatedTimestamp";
import type { EventRow, PredictionRow } from "@/lib/types";

interface Props {
  event: EventRow;
  prediction: PredictionRow | null;
}

export function SubQuestionCard({ event, prediction }: Props) {
  const top = prediction?.ranked_outcomes?.[0] ?? null;
  const updatedAt = prediction?.generated_at ?? null;
  const topProb = top?.probability ?? null;

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
        <UpdatedTimestamp iso={updatedAt} />
      </div>

      {top?.outcome_label && (
        <div
          className="mt-2 flex items-center justify-between gap-3 font-body text-xs"
          style={{ color: "var(--ink-soft)" }}
        >
          <span>
            Lean:{" "}
            <span style={{ color: "var(--ink)" }}>{top.outcome_label}</span>
          </span>
          <OddsDisplay probability={topProb} domain={event.domain} />
        </div>
      )}
    </article>
  );
}
