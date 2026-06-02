import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { DOMAIN_LABEL, type DomainId } from "@/lib/types";

export function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="match">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

interface SearchResultCardProps {
  event: {
    event_id?: string;
    id?: string;
    domain: string;
    slug: string;
    title: string;
    status?: string;
    top_pick_label: string | null;
    top_pick_pct: number | null;
  };
  query?: string;
}

export function SearchResultCard({ event, query = "" }: SearchResultCardProps) {
  const pct = event.top_pick_pct != null ? Math.round(event.top_pick_pct) : null;
  const statusLabel = event.status === "resolved" ? "SCORED" : "UPCOMING";
  const domainLabel =
    DOMAIN_LABEL[event.domain as DomainId]?.toUpperCase() ??
    event.domain.toUpperCase();
  return (
    <Link
      to="/$domain/events/$slug"
      params={{ domain: event.domain, slug: event.slug }}
      className="result-card"
    >
      <div className="result-meta">
        <div className="result-eyebrow-row">
          <span className="result-domain">{domainLabel}</span>
          <span className="result-status">{statusLabel}</span>
        </div>
        <div className="result-title">{highlightMatch(event.title, query)}</div>
        {event.top_pick_label && (
          <div className="result-pick">{event.top_pick_label}</div>
        )}
      </div>
      {pct != null && (
        <div className="result-pct">
          {pct}
          <span className="small">%</span>
        </div>
      )}
    </Link>
  );
}
