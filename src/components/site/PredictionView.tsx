// Renders a current prediction: top pick, ranked alternates, and a brief
// "why this forecast" panel. We never expose model count, agreement %,
// Borda math, or model names on public surfaces.

import type { PredictionRow, RankedOutcome } from "@/lib/types";
import { ConfidenceLabel } from "./ConfidenceLabel";
import { DataTierBadge } from "./DataTierBadge";

function pct(p: number | undefined): string {
  if (typeof p !== "number") return "—";
  return `${Math.round(p)}%`;
}

function OutcomeCard({
  outcome,
  rank,
  highlight,
}: {
  outcome: RankedOutcome;
  rank: number;
  highlight?: boolean;
}) {
  const label = outcome.outcome_label ?? outcome.outcome_id ?? "—";
  return (
    <div
      className={
        "rounded-xl p-4 " +
        (highlight
          ? "shadow-sm"
          : "")
      }
      style={{
        background: highlight ? "var(--bg-tint)" : "var(--bg-card)",
        border: highlight
          ? "1.5px solid var(--amber)"
          : "1px solid var(--border-soft)",
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--ink-faint)" }}
          >
            #{rank}
          </span>
          <h3
            className={
              highlight
                ? "font-display text-lg"
                : "font-display text-sm"
            }
            style={{ fontWeight: highlight ? 700 : 600 }}
          >
            {label}
          </h3>
          {outcome.is_dark_horse && (
            <span
              className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
              style={{
                background: "var(--bg-tint)",
                color: "var(--amber-strong)",
              }}
            >
              Dark horse
            </span>
          )}
        </div>
        <span
          className={
            highlight
              ? "font-mono text-2xl"
              : "font-mono text-sm"
          }
          style={{ color: highlight ? "var(--amber)" : "var(--ink-soft)" }}
        >
          {pct(outcome.probability)}
        </span>
      </div>
      {highlight && outcome.reasons && outcome.reasons.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {outcome.reasons.slice(0, 3).map((r, i) => (
            <li
              key={i}
              className="font-body flex gap-2 text-sm"
              style={{ color: "var(--ink-soft)" }}
            >
              <span style={{ color: "var(--amber)" }}>•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PredictionView({ prediction }: { prediction: PredictionRow }) {
  const [top, ...rest] = prediction.ranked_outcomes ?? [];
  const darkHorses = [
    ...(prediction.ranked_outcomes ?? []),
    ...(prediction.alternates ?? []),
  ].filter((p) => p.is_dark_horse);

  if (!top) {
    return (
      <p
        className="font-body rounded-lg p-4 text-sm"
        style={{
          border: "1px dashed var(--border-soft)",
          color: "var(--ink-soft)",
        }}
      >
        No outcomes ranked yet.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: "var(--ink-faint)" }}
          >
            Top pick
          </h2>
          <ConfidenceLabel tier={prediction.confidence} />
        </div>
        <OutcomeCard outcome={top} rank={1} highlight />
      </section>

      {rest.length > 0 && (
        <section>
          <h2
            className="font-mono mb-3 text-[10px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: "var(--ink-faint)" }}
          >
            Other picks
          </h2>
          <div className="space-y-2">
            {rest.map((o, i) => (
              <OutcomeCard key={o.outcome_id ?? i} outcome={o} rank={i + 2} />
            ))}
          </div>
        </section>
      )}

      <section
        className="rounded-xl p-4"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-soft)",
        }}
      >
        <h2
          className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: "var(--ink-faint)" }}
        >
          Why this forecast
        </h2>
        <p
          className="font-body mt-2 text-sm leading-relaxed"
          style={{ color: "var(--ink-soft)" }}
        >
          The Prophiq engine weighs recent form, historical patterns, real-time
          signals, and a domain-specific statistical fit. Confidence above
          reflects how cleanly that evidence converged.
        </p>
        {darkHorses.length > 0 && (
          <div
            className="mt-4 border-t pt-3"
            style={{ borderColor: "var(--border-soft)" }}
          >
            <p
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em]"
              style={{ color: "var(--amber-strong)" }}
            >
              Dark horses to watch
            </p>
            <ul
              className="font-body mt-2 space-y-1 text-sm"
              style={{ color: "var(--ink-soft)" }}
            >
              {darkHorses.map((d, i) => (
                <li key={i}>
                  <span className="font-medium" style={{ color: "var(--ink)" }}>
                    {d.outcome_label ?? d.outcome_id}
                  </span>
                  {typeof d.probability === "number" && (
                    <span
                      className="ml-2 font-mono"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      {pct(d.probability)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
