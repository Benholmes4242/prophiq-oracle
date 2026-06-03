// RelatedEvents — refreshed "Related forecasts" list under the event detail
// page. Pulls 3 same-domain events (semantic relatedness is a follow-up
// brief). Each card shows the domain eyebrow, the event title, and a short
// countdown meta line.

import { Link } from "@tanstack/react-router";
import { useDomainEvents } from "@/hooks/useEvents";
import { DOMAIN_LABEL } from "@/lib/types";
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
    <section className="mt-2">
      <div className="section-row">
        <span className="section-eyebrow">RELATED FORECASTS</span>
        <span className="section-rule" />
      </div>
      <div className="related-list">
        {related.map(({ event }) => (
          <Link
            key={event.id}
            to="/$domain/events/$slug"
            params={{ domain: event.domain, slug: event.slug }}
            className="related-card"
          >
            <div className="related-domain">{DOMAIN_LABEL[event.domain]}</div>
            <div className="related-title">{event.title}</div>
            <div className="related-meta" suppressHydrationWarning>
              {formatRelatedMeta(event.starts_at)}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function formatRelatedMeta(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  const dateLabel = d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: diffDays > 60 || diffDays < -60 ? "numeric" : undefined,
  });

  if (diffDays === 0) return `${dateLabel} · today`;
  if (diffDays === 1) return `${dateLabel} · tomorrow`;
  if (diffDays > 1) return `${dateLabel} · in ${diffDays} days`;
  if (diffDays === -1) return `${dateLabel} · yesterday`;
  return `${dateLabel} · ${Math.abs(diffDays)} days ago`;
}
