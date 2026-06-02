// EventHero — top card on the event detail page. Geist typography (no
// Bricolage), no HIGH confidence badge, pick row at the bottom with the big
// percentage on the right.

import { useEffect, useMemo, useState } from "react";
import { SourceBadge } from "./SourceBadge";
import { DOMAIN_LABEL } from "@/lib/types";
import type { EventRow } from "@/lib/types";

interface EventHeroProps {
  event: EventRow;
  topPickLabel: string | null;
  topPickPct: number | null;
}

export function EventHero({ event, topPickLabel, topPickPct }: EventHeroProps) {
  const countdown = useCountdown(event.starts_at);
  const pct = topPickPct != null ? Math.round(topPickPct) : null;
  return (
    <header className="event-hero">
      <div className="hero-eyebrow-row">
        <span className="hero-domain">
          {DOMAIN_LABEL[event.domain].toUpperCase()}
        </span>
        <span className="hero-source-badge">
          <SourceBadge source={event.source} />
        </span>
      </div>

      <h1 className="hero-title">{event.question || event.title}</h1>
      <p className="hero-countdown" suppressHydrationWarning>
        {countdown}
      </p>

      {topPickLabel && (
        <>
          <div className="hero-divider" />
          <div className="hero-pick-row">
            <div className="min-w-0">
              <div className="hero-pick-label">TOP PICK</div>
              <div className="hero-pick-name">{topPickLabel}</div>
            </div>
            {pct != null && (
              <div className="hero-pct">
                {pct}
                <span className="small">%</span>
              </div>
            )}
          </div>
          {pct != null && (
            <div className="hero-bar">
              <div className="hero-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
        </>
      )}
    </header>
  );
}

function useCountdown(iso: string): string {
  const target = useMemo(() => new Date(iso).getTime(), [iso]);
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((v) => v + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const diff = target - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  let label: string;
  if (days > 1) label = `${days} days`;
  else if (hours >= 1) label = `${hours}h ${minutes % 60}m`;
  else label = `${minutes}m`;
  const when = new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return diff > 0 ? `Starts in ${label} · ${when}` : `Started ${label} ago · ${when}`;
}
