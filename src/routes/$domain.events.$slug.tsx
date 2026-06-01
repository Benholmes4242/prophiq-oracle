// Event detail page. SSR-rendered for SEO with JSON-LD Event structured
// data. Loader fetches the event row up-front so head() can produce
// per-event meta + JSON-LD. The current prediction is fetched client-side
// because it may stream in after the page shell renders.

import { useEffect, useMemo, useState } from "react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/SiteShell";
import { SourceBadge } from "@/components/site/SourceBadge";
import { DomainDisclaimer } from "@/components/site/DisclaimerBanner";
import { PredictionView } from "@/components/site/PredictionView";
import { ChatPanel } from "@/components/site/ChatPanel";
import { useCurrentPrediction } from "@/hooks/usePrediction";
import { fetchEventBySlug } from "@/lib/queries";
import { DOMAINS, DOMAIN_LABEL } from "@/lib/types";
import type { DomainId, EventRow } from "@/lib/types";

export const Route = createFileRoute("/$domain/events/$slug")({
  loader: async ({ params }) => {
    const event = await fetchEventBySlug(params.slug);
    if (!event || event.domain !== params.domain) throw notFound();
    return { event };
  },
  head: ({ loaderData, params }) => {
    const event = loaderData?.event;
    if (!event) {
      return { meta: [{ title: "Event — Prophiq" }] };
    }
    const title = `${event.title} — Prophiq`;
    const description =
      event.description ??
      `Multi-model consensus prediction for ${event.title}. ${DOMAIN_LABEL[event.domain]} on Prophiq.`;
    const url = `https://prophiq-opinion-nexus.lovable.app/${params.domain}/events/${params.slug}`;
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Event",
      name: event.title,
      description,
      startDate: event.starts_at,
      endDate: event.resolves_at,
      eventStatus:
        event.status === "cancelled"
          ? "https://schema.org/EventCancelled"
          : "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    };
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(jsonLd),
        },
      ],
    };
  },
  notFoundComponent: EventNotFound,
  errorComponent: EventError,
  component: EventDetailPage,
});

function EventNotFound() {
  const { domain, slug } = Route.useParams();
  return (
    <SiteShell>
      <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Event not found</h1>
        <p className="mt-3 text-sm text-slate-600">
          We couldn't find an event at <span className="font-mono">/{domain}/events/{slug}</span>.
          It may have been removed or never existed.
        </p>
      </div>
    </SiteShell>
  );
}

function EventError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <SiteShell>
      <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">This event didn't load</h1>
        <p className="mt-3 text-sm text-slate-600">{error.message}</p>
        <button
          type="button"
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 rounded-md bg-[var(--brand-ink)] px-4 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
      </div>
    </SiteShell>
  );
}

function EventDetailPage() {
  const { event } = Route.useLoaderData();
  const mode: "prediction" | "odds" = event.mode === "odds" ? "odds" : "prediction";

  const domainId = (DOMAINS as string[]).includes(event.domain)
    ? (event.domain as DomainId)
    : null;

  return (
    <SiteShell>
      {domainId && <DomainDisclaimer domain={domainId} />}
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_360px]">
        <article className="min-w-0">
          <EventHeader event={event} />
          {event.domain === "sport" && mode === "odds" && <GamblingBanner />}
          <div className="mt-6">
            <PredictionBlock eventId={event.id} mode={mode} />
          </div>
        </article>
        <ChatPanel eventId={event.id} />
      </div>
    </SiteShell>
  );
}

function EventHeader({ event }: { event: EventRow }) {
  const countdown = useCountdown(event.starts_at);
  return (
    <header className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {DOMAIN_LABEL[event.domain]}
        </span>
        <SourceBadge source={event.source} />
      </div>
      <h1 className="text-2xl font-bold leading-tight tracking-tight text-[var(--brand-ink)] sm:text-3xl">
        {event.title}
      </h1>
      <p className="text-sm text-slate-600">{event.question}</p>
      <p className="text-xs font-mono text-slate-500" suppressHydrationWarning>
        {countdown}
      </p>
    </header>
  );
}

// ModeTabs removed — no user-facing mode/odds switcher.

function GamblingBanner() {
  return (
    <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 sm:text-sm">
      <strong>Gamble responsibly.</strong> Odds are model-generated and informational. 18+. If
      gambling is affecting your life, visit{" "}
      <a
        href="https://www.begambleaware.org"
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        BeGambleAware.org
      </a>
      .
    </div>
  );
}

function PredictionBlock({
  eventId,
  mode,
}: {
  eventId: string;
  mode: "prediction" | "odds";
}) {
  const { data: prediction, isLoading, error } = useCurrentPrediction(eventId, mode);

  if (isLoading) return <PredictionSkeleton />;
  if (error) {
    return (
      <p className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
        Couldn't load this prediction. Please refresh and try again.
      </p>
    );
  }
  if (!prediction) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
        Prophiq is thinking — check back in a few minutes.
      </p>
    );
  }
  return <PredictionView prediction={prediction} />;
}

function PredictionSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-28 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
    </div>
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
  });
  return diff > 0 ? `Starts in ${label} · ${when}` : `Started ${label} ago · ${when}`;
}
