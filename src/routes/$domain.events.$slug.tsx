// Event detail page. SSR-rendered for SEO with JSON-LD Event structured
// data. Loader fetches the event row up-front so head() can produce
// per-event meta + JSON-LD.

import { useEffect, useMemo, useState } from "react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteShell } from "@/components/site/SiteShell";
import { SourceBadge } from "@/components/site/SourceBadge";
import { DomainDisclaimer } from "@/components/site/DisclaimerBanner";
import { PredictionView } from "@/components/site/PredictionView";
import { ChatPanel } from "@/components/site/ChatPanel";
import { ConfidenceLabel } from "@/components/site/ConfidenceLabel";
import { EventResolvedBanner } from "@/components/site/EventResolvedBanner";
import { RelatedEvents } from "@/components/site/RelatedEvents";
import { useCurrentPrediction } from "@/hooks/usePrediction";
import { fetchEventBySlug, fetchEventResolution } from "@/lib/queries";
import { getPublicBaseUrl } from "@/lib/publicUrl";
import { DOMAINS, DOMAIN_LABEL } from "@/lib/types";
import type { DomainId, EventRow, PredictionRow } from "@/lib/types";

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
      `Calibrated prediction for ${event.title}. ${DOMAIN_LABEL[event.domain]} on Prophiq.`;
    const base = getPublicBaseUrl();
    const url = `${base}/${params.domain}/events/${params.slug}`;
    const ogImage = `${base}/api/og/event/${params.slug}`;
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
        { property: "og:image", content: ogImage },
        { property: "twitter:card", content: "summary_large_image" },
        { property: "twitter:image", content: ogImage },
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
        <h1 className="font-display text-2xl tracking-tight" style={{ fontWeight: 700 }}>
          Event not found
        </h1>
        <p className="mt-3 font-body text-sm" style={{ color: "var(--ink-soft)" }}>
          We couldn't find an event at <span className="font-mono">/{domain}/events/{slug}</span>.
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
        <h1 className="font-display text-2xl tracking-tight" style={{ fontWeight: 700 }}>
          This event didn't load
        </h1>
        <p className="mt-3 font-body text-sm" style={{ color: "var(--ink-soft)" }}>
          {error.message}
        </p>
        <button
          type="button"
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 rounded-md px-4 py-2 font-body text-sm font-medium text-white"
          style={{ background: "var(--ink)" }}
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
  const { data: prediction, isLoading, error } = useCurrentPrediction(event.id, mode);
  const isResolved = event.status === "resolved";
  const { data: resolution } = useQuery({
    queryKey: ["event-resolution", event.id],
    queryFn: () => fetchEventResolution(event.id),
    enabled: isResolved,
    staleTime: 5 * 60_000,
  });

  const domainId = (DOMAINS as string[]).includes(event.domain)
    ? (event.domain as DomainId)
    : null;

  const top = prediction?.ranked_outcomes?.[0] ?? null;
  const topPct =
    top?.probability != null ? Math.round(top.probability) : null;

  return (
    <SiteShell>
      {domainId && <DomainDisclaimer domain={domainId} />}
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_360px]">
        <article className="min-w-0 space-y-6">
          {isResolved && resolution && (
            <EventResolvedBanner
              correct={resolution.top_pick_correct === true}
              actualOutcome={resolution.actual_outcome}
              topPickAtTime={top?.outcome_label ?? null}
              topPickPct={top?.probability ?? null}
            />
          )}
          <EventHero
            event={event}
            prediction={prediction ?? null}
            topPct={topPct}
            topLabel={top?.outcome_label ?? null}
          />
          {event.domain === "sport" && mode === "odds" && <GamblingBanner />}
          <PredictionBlock prediction={prediction ?? null} isLoading={isLoading} error={error as Error | null} />
          {domainId && (
            <RelatedEvents domain={domainId} excludeId={event.id} limit={3} />
          )}
        </article>
        <ChatPanel eventId={event.id} />
      </div>
    </SiteShell>
  );
}

function EventHero({
  event,
  prediction,
  topPct,
  topLabel,
}: {
  event: EventRow;
  prediction: PredictionRow | null;
  topPct: number | null;
  topLabel: string | null;
}) {
  const countdown = useCountdown(event.starts_at);
  return (
    <header
      className="rounded-2xl p-5"
      style={{
        background: "var(--bg-card)",
        border: "1.5px solid var(--border-strong)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[10px] tracking-[0.2em]"
            style={{ color: "var(--amber-strong)", fontWeight: 600 }}
          >
            {DOMAIN_LABEL[event.domain].toUpperCase()}
          </span>
          <SourceBadge source={event.source} />
        </div>
        {prediction && <ConfidenceLabel tier={prediction.confidence} />}
      </div>
      <h1
        className="mt-3 font-display tracking-[-0.02em]"
        style={{ fontWeight: 700, fontSize: 28, lineHeight: 1.1 }}
      >
        {event.question || event.title}
      </h1>
      <p
        className="mt-2 font-mono text-[11px]"
        style={{ color: "var(--ink-faint)" }}
        suppressHydrationWarning
      >
        {countdown}
      </p>

      {topLabel && (
        <>
          <hr
            className="my-4 border-0"
            style={{ height: 1, background: "var(--border-soft)" }}
          />
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div
                className="mb-1 font-mono text-[10px] tracking-[0.18em]"
                style={{ color: "var(--ink-faint)", fontWeight: 600 }}
              >
                TOP PICK
              </div>
              <div
                className="font-display text-[22px] leading-tight"
                style={{ fontWeight: 600 }}
              >
                {topLabel}
              </div>
            </div>
            {topPct != null && (
              <div
                className="font-mono leading-none tracking-[-0.03em]"
                style={{ color: "var(--amber)", fontWeight: 600, fontSize: 56 }}
              >
                {topPct}
                <span className="text-[28px]">%</span>
              </div>
            )}
          </div>
          {topPct != null && (
            <div className="mt-3 prob-bar">
              <span style={{ width: `${topPct}%` }} />
            </div>
          )}
        </>
      )}
    </header>
  );
}

function GamblingBanner() {
  return (
    <div
      className="rounded-lg px-3 py-2 font-body text-xs sm:text-sm"
      style={{
        background: "var(--bg-tint)",
        border: "1px solid var(--amber)",
        color: "var(--ink)",
      }}
    >
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
  prediction,
  isLoading,
  error,
}: {
  prediction: PredictionRow | null;
  isLoading: boolean;
  error: Error | null;
}) {
  if (isLoading) return <PredictionSkeleton />;
  if (error) {
    return (
      <p
        className="rounded-lg p-4 font-body text-sm"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--amber)",
          color: "var(--ink)",
        }}
      >
        Couldn't load this prediction. Please refresh and try again.
      </p>
    );
  }
  if (!prediction) {
    return (
      <p
        className="rounded-lg p-4 font-body text-sm"
        style={{
          border: "1px dashed var(--border-soft)",
          color: "var(--ink-soft)",
        }}
      >
        Prophiq is thinking — check back in a few minutes.
      </p>
    );
  }
  return <PredictionView prediction={prediction} />;
}

function PredictionSkeleton() {
  return (
    <div className="space-y-3">
      <div
        className="h-28 animate-pulse rounded-xl"
        style={{ background: "var(--bg-card)" }}
      />
      <div
        className="h-16 animate-pulse rounded-xl"
        style={{ background: "var(--bg-card)" }}
      />
      <div
        className="h-16 animate-pulse rounded-xl"
        style={{ background: "var(--bg-card)" }}
      />
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
