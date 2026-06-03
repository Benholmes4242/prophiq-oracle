// EventHero — content-led hero for the event detail page. Domain + subcategory
// eyebrow, length-scaled title, and a smart-date + countdown meta line. The
// pick row was moved out: CallSection owns all probability surfaces now.

import { useEffect, useMemo, useState } from "react";
import { DOMAIN_LABEL } from "@/lib/types";
import type { EventRow } from "@/lib/types";

interface EventHeroProps {
  event: EventRow;
  subcategory?: string | null;
}

export function EventHero({ event, subcategory }: EventHeroProps) {
  const eyebrowText = subcategory
    ? `${DOMAIN_LABEL[event.domain]} · ${subcategory}`
    : DOMAIN_LABEL[event.domain];

  const titleText = event.question || event.title;
  const titleFontSize = titleText.length > 70 ? 22 : 26;

  const meta = useEventMeta(event.starts_at);

  return (
    <header className="event-hero">
      <div className="hero-eyebrow-row">
        <span className="hero-domain">{eyebrowText}</span>
      </div>
      <h1
        className="hero-title"
        style={{ fontSize: `${titleFontSize}px` }}
      >
        {titleText}
      </h1>
      <p className="hero-countdown" suppressHydrationWarning>
        {meta}
      </p>
    </header>
  );
}

function useEventMeta(iso: string): string {
  const target = useMemo(() => new Date(iso).getTime(), [iso]);
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((v) => v + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const date = new Date(iso);
  const now = Date.now();
  const diffMs = target - now;
  const absMs = Math.abs(diffMs);
  const days = Math.floor(absMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor(absMs / (60 * 60 * 1000));
  const minutes = Math.floor(absMs / 60_000);

  const yearNeeded = days > 60;
  const isMidnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0;
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(yearNeeded ? { year: "numeric" } : {}),
  };
  const datePart = date.toLocaleDateString(undefined, dateOpts);

  let timePart = "";
  if (!isMidnight) {
    const timeStr = date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const tz = Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value;
    timePart = tz ? ` · ${timeStr} ${tz}` : ` · ${timeStr}`;
  }

  let countdown: string;
  if (diffMs > 0) {
    if (days >= 2) countdown = `${days} days away`;
    else if (hours >= 1) countdown = `in ${hours}h ${minutes % 60}m`;
    else countdown = `in ${minutes}m`;
  } else {
    if (days >= 1) countdown = `started ${days}d ago`;
    else if (hours >= 1) countdown = `started ${hours}h ago`;
    else countdown = `started ${minutes}m ago`;
  }

  return `${datePart} · ${countdown}${timePart}`;
}
