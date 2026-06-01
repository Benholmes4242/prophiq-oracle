// Renders a current prediction: top pick, ranked alternates, and the
// "why this prediction" explainer (consensus method, agreement, dark horses).

import type { PredictionRow, RankedOutcome } from "@/lib/types";

function pct(p: number | undefined): string {
  if (typeof p !== "number") return "—";
  return `${Math.round(p)}%`;
}

function methodLabel(method: PredictionRow["consensus_method"]): string {
  return method === "weighted_borda_count"
    ? "Weighted Borda count across three frontier models"
    : "Single-model fallback (other models unavailable)";
}

function agreementLabel(score: number | null): string {
  if (score == null) return "—";
  if (score >= 80) return "Strong agreement";
  if (score >= 50) return "Moderate agreement";
  return "Low agreement";
}

function modelsContributed(prediction: PredictionRow): string[] {
  const out = new Set<string>();
  const results = prediction.model_results as Array<{ model?: string; provider?: string; error?: string }>;
  for (const r of results) {
    if (r?.error) continue;
    const name = r?.model ?? r?.provider;
    if (typeof name === "string" && name.length > 0) out.add(name);
  }
  return Array.from(out);
}

function totalModelsAttempted(prediction: PredictionRow): number {
  const results = prediction.model_results as Array<{ error?: string }>;
  return results.length;
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
        "rounded-xl border p-4 " +
        (highlight
          ? "border-[var(--brand-amber)] bg-amber-50/40 shadow-sm"
          : "border-[var(--brand-border)] bg-white")
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            #{rank}
          </span>
          <h3 className={highlight ? "text-lg font-semibold" : "text-sm font-medium"}>{label}</h3>
          {outcome.is_dark_horse && (
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-700">
              Dark horse
            </span>
          )}
        </div>
        <span className={highlight ? "text-2xl font-mono text-[var(--brand-ink)]" : "text-sm font-mono text-slate-700"}>
          {pct(outcome.probability)}
        </span>
      </div>
      {highlight && outcome.reasons && outcome.reasons.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {outcome.reasons.slice(0, 3).map((r, i) => (
            <li key={i} className="flex gap-2 text-sm text-slate-700">
              <span className="text-[var(--brand-amber)]">•</span>
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
  const models = modelsContributed(prediction);
  const totalAttempted = totalModelsAttempted(prediction);
  const darkHorses = [
    ...(prediction.ranked_outcomes ?? []),
    ...(prediction.alternates ?? []),
  ].filter((p) => p.is_dark_horse);

  if (!top) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
        No outcomes ranked yet.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Top pick
        </h2>
        <OutcomeCard outcome={top} rank={1} highlight />
      </section>

      {rest.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Other picks
          </h2>
          <div className="space-y-2">
            {rest.map((o, i) => (
              <OutcomeCard key={o.outcome_id ?? i} outcome={o} rank={i + 2} />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-[var(--brand-border)] bg-slate-50/60 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Why this prediction
        </h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Method</dt>
            <dd className="font-medium text-[var(--brand-ink)]">{methodLabel(prediction.consensus_method)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Model agreement</dt>
            <dd className="font-medium text-[var(--brand-ink)]">
              {agreementLabel(prediction.agreement_score)}
              {prediction.agreement_score != null && (
                <span className="ml-1 text-slate-500 font-mono">
                  ({Math.round(prediction.agreement_score)}%)
                </span>
              )}
            </dd>
          </div>
          {models.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Models that contributed</dt>
              <dd className="font-medium text-[var(--brand-ink)]">
                {models.join(", ")}
                <span className="ml-1 text-slate-500">
                  ({models.length} of {totalAttempted} models)
                </span>
              </dd>
            </div>
          )}
        </dl>
        {darkHorses.length > 0 && (
          <div className="mt-4 border-t border-slate-200 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-purple-700">
              Dark horses to watch
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {darkHorses.map((d, i) => (
                <li key={i}>
                  <span className="font-medium">{d.outcome_label ?? d.outcome_id}</span>
                  {typeof d.probability === "number" && (
                    <span className="ml-2 font-mono text-slate-500">{pct(d.probability)}</span>
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
