import { Link } from "@tanstack/react-router";
import { classifyEvent } from "@/lib/subcategory";
import type { DomainId, EventWithPrediction } from "@/lib/types";

interface DomainUpcomingListProps {
  events: EventWithPrediction[];
  domain: DomainId;
  subcategory: string;
}

/** Returns a short start-time label for pending cards: "SAT 14:00", "JUN 14". */
function startTimeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays >= 0 && diffDays <= 6) {
    return d
      .toLocaleString(undefined, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
      .toUpperCase();
  }
  return d
    .toLocaleDateString(undefined, { day: "numeric", month: "short" })
    .toUpperCase();
}

export function DomainUpcomingList({
  events,
  domain,
  subcategory,
}: DomainUpcomingListProps) {
  const filtered =
    subcategory === "All"
      ? events
      : events.filter(
          (e) => classifyEvent(e.event.title, domain) === subcategory,
        );

  if (filtered.length === 0) {
    return (
      <p
        className="rounded-xl px-4 py-6 text-center"
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          background: "var(--bg-card)",
          border: "1px dashed var(--line)",
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
        const pct =
          top?.probability != null ? Math.round(top.probability) : null;
        const hasPick = top != null && pct != null;
        const subcat = classifyEvent(event.title, domain);

        return (
          <Link
            key={event.id}
            to="/$domain/events/$slug"
            params={{ domain: event.domain, slug: event.slug }}
            className="event-card flex items-center gap-3 rounded-xl px-4 py-3.5"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--line)",
              transition:
                "border-color 180ms var(--ease-ios), transform 120ms var(--ease-ios), background-color 180ms var(--ease-ios)",
            }}
          >
            <div className="min-w-0 flex-1">
              <div
                className="mb-1 font-mono"
                style={{
                  fontSize: 9.5,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "var(--ink-faint)",
                  fontWeight: 600,
                }}
              >
                {subcat}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: 600,
                  fontSize: 15,
                  lineHeight: 1.25,
                  letterSpacing: "-0.01em",
                  color: hasPick ? "var(--ink)" : "var(--ink-soft)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {event.title}
              </div>
              {hasPick ? (
                <div
                  className="mt-1 truncate"
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 12.5,
                    color: "var(--ink-soft)",
                  }}
                >
                  {top!.outcome_label}
                </div>
              ) : (
                <div
                  className="mt-1 truncate"
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 12.5,
                    fontStyle: "italic",
                    color: "var(--ink-faint)",
                  }}
                >
                  Awaiting forecast
                </div>
              )}
            </div>
            <div className="shrink-0 text-right">
              {hasPick ? (
                <div
                  className="font-mono leading-none"
                  style={{
                    color: "var(--amber)",
                    fontWeight: 600,
                    fontSize: 24,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {pct}
                  <span style={{ fontSize: 14 }}>%</span>
                </div>
              ) : (
                <div
                  className="font-mono"
                  style={{
                    fontSize: 10.5,
                    letterSpacing: "0.14em",
                    color: "var(--ink-faint)",
                    fontWeight: 600,
                  }}
                >
                  {startTimeLabel(event.starts_at)}
                </div>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
