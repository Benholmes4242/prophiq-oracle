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
        <span className="section-eyebrow">RELATED EVENTS</span>
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
            <div className="related-row">
              <span className="related-domain">{DOMAIN_LABEL[event.domain].toUpperCase()}</span>
              <span className="related-title">{event.title}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
