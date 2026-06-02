import { Link } from "@tanstack/react-router";
import { ConfidenceLabel } from "./ConfidenceLabel";
import { classifyEvent } from "@/lib/subcategory";
import type { DomainId, EventWithPrediction } from "@/lib/types";

interface DomainUpcomingListProps {
  events: EventWithPrediction[];
  domain: DomainId;
  subcategory: string;
}

export function DomainUpcomingList({ events, domain, subcategory }: DomainUpcomingListProps) {
  const filtered =
    subcategory === "All"
      ? events
      : events.filter((e) => classifyEvent(e.event.title, domain) === subcategory);

  if (filtered.length === 0) {
    return (
      <p
        className="rounded-xl px-4 py-6 text-center font-body text-[13px]"
        style={{
          background: "var(--bg-card)",
          border: "1px dashed var(--border-soft)",
          color: "var(--ink-soft)",
        }}
      >
        No upcoming events match this filter. Try All, or come back tomorrow.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {filtered.map(({ event, prediction }) => {
        const top = prediction?.ranked_outcomes?.[0];
        const label = top?.outcome_label ?? "—";
        const pct = top?.probability != null ? Math.round(top.probability) : null;
        const subcat = classifyEvent(event.title, domain);
        return (
          <Link
            key={event.id}
            to="/$domain/events/$slug"
            params={{ domain: event.domain, slug: event.slug }}
            className="flex items-center gap-3 rounded-xl px-4 py-3.5 transition-ios-colors hover:bg-[var(--bg-tint)]/40"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-soft)",
            }}
          >
            <div className="min-w-0 flex-1">
              <div
                className="mb-1 font-mono text-[9px] tracking-[0.2em]"
                style={{ color: "var(--amber-strong)", fontWeight: 600 }}
              >
                {subcat.toUpperCase()}
              </div>
              <div
                className="truncate font-display text-[15px] leading-snug"
                style={{ fontWeight: 600 }}
              >
                {event.title}
              </div>
              <div
                className="mt-0.5 truncate font-body text-[12.5px]"
                style={{ color: "var(--ink-soft)" }}
              >
                {label}
              </div>
            </div>
            <div className="shrink-0 text-right">
              {pct != null && (
                <div
                  className="font-mono text-[24px] leading-none tracking-tight"
                  style={{ color: "var(--amber)", fontWeight: 600 }}
                >
                  {pct}
                  <span className="text-[14px]">%</span>
                </div>
              )}
              {prediction && (
                <div className="mt-1.5 flex justify-end">
                  <ConfidenceLabel tier={prediction.confidence} compact />
                </div>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
