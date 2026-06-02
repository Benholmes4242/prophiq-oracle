import { Link } from "@tanstack/react-router";
import { useDomainEvents } from "@/hooks/useEvents";
import type { DomainId } from "@/lib/types";

interface Props {
  domain: DomainId;
  excludeId: string;
  limit?: number;
}

export function RelatedEvents({ domain, excludeId, limit = 3 }: Props) {
  const { data: events = [], isLoading } = useDomainEvents(domain);
  const related = events.filter((e) => e.event.id !== excludeId).slice(0, limit);

  if (isLoading) return null;
  if (related.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="flex items-center gap-3 pb-3">
        <span
          className="font-mono text-[10px] tracking-[0.2em]"
          style={{ color: "var(--ink-faint)", fontWeight: 600 }}
        >
          RELATED EVENTS
        </span>
        <span
          className="h-px flex-1"
          style={{ background: "var(--border-soft)" }}
        />
      </div>
      <div className="space-y-2.5">
        {related.map(({ event, prediction }) => {
          const top = prediction?.ranked_outcomes?.[0];
          const pct = top?.probability != null ? Math.round(top.probability) : null;
          return (
            <Link
              key={event.id}
              to="/$domain/events/$slug"
              params={{ domain: event.domain, slug: event.slug }}
              className="flex items-center gap-3 rounded-xl px-4 py-3 transition-ios-colors hover:bg-[var(--bg-tint)]/40"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-soft)",
              }}
            >
              <div className="min-w-0 flex-1">
                <div
                  className="truncate font-display text-[14px] leading-snug"
                  style={{ fontWeight: 600 }}
                >
                  {event.title}
                </div>
                {top?.outcome_label && (
                  <div
                    className="mt-0.5 truncate font-body text-[12px]"
                    style={{ color: "var(--ink-soft)" }}
                  >
                    {top.outcome_label}
                  </div>
                )}
              </div>
              {pct != null && (
                <div
                  className="shrink-0 font-mono text-[18px] leading-none"
                  style={{ color: "var(--amber)", fontWeight: 600 }}
                >
                  {pct}
                  <span className="text-[11px]">%</span>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
