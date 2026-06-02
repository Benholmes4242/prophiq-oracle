import { Link } from "@tanstack/react-router";
import type { EventRow, PredictionRow } from "@/lib/types";
import { DOMAIN_LABEL } from "@/lib/types";
import { SourceBadge } from "./SourceBadge";

function formatStart(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function EventCard({
  event,
  prediction,
}: {
  event: EventRow;
  prediction?: PredictionRow | null;
}) {
  const topPick = prediction?.ranked_outcomes?.[0];
  return (
    <Link
      to="/$domain/events/$slug"
      params={{ domain: event.domain, slug: event.slug }}
      className="group block rounded-xl border border-[var(--brand-border)] bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.02)] transition-ios hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {DOMAIN_LABEL[event.domain]}
        </span>
        <SourceBadge source={event.source} />
      </div>
      <h3 className="mt-2 text-base font-semibold leading-snug text-[var(--brand-ink)] group-hover:underline decoration-[var(--brand-amber)] decoration-2 underline-offset-2">
        {event.title}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{formatStart(event.starts_at)}</p>

      {topPick ? (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Top pick
            </span>
            {typeof topPick.probability === "number" && (
              <span className="text-xs font-mono text-slate-700">
                {Math.round(topPick.probability)}%
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-[var(--brand-ink)]">{topPick.outcome_label ?? topPick.outcome_id}</p>
        </div>
      ) : (
        <p className="mt-3 text-xs italic text-slate-400">Prediction generating…</p>
      )}
    </Link>
  );
}
