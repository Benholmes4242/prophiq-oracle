// Event detail page. SSR-rendered for SEO with JSON-LD Event structured
// data. AppHeader comes from __root.tsx; this page provides its own bottom
// UX (disclaimer + sticky CTA + chat sheet) and does NOT render SiteShell.

import { useState } from "react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DomainDisclaimer } from "@/components/site/DisclaimerBanner";
import { EventResolvedBanner } from "@/components/site/EventResolvedBanner";
import { EventHero } from "@/components/site/EventHero";
import { ReasoningCard } from "@/components/site/ReasoningCard";
import { OtherContenders } from "@/components/site/OtherContenders";
import { MethodologyCard } from "@/components/site/MethodologyCard";
import { RelatedEvents } from "@/components/site/RelatedEvents";
import { StickyBottomCTA } from "@/components/site/StickyBottomCTA";
import { ChatSheet } from "@/components/site/ChatSheet";
import { useCurrentPrediction } from "@/hooks/usePrediction";
import { fetchEventBySlug, fetchEventResolution } from "@/lib/queries";
import { getPublicBaseUrl } from "@/lib/publicUrl";
import { DOMAINS, DOMAIN_LABEL } from "@/lib/types";
import type { DomainId } from "@/lib/types";

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
    <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
      <h1 className="font-sans text-2xl tracking-tight" style={{ fontWeight: 700 }}>
        Event not found
      </h1>
      <p className="mt-3 font-body text-sm" style={{ color: "var(--ink-soft)" }}>
        We couldn't find an event at <span className="font-mono">/{domain}/events/{slug}</span>.
      </p>
    </div>
  );
}

function EventError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
      <h1 className="font-sans text-2xl tracking-tight" style={{ fontWeight: 700 }}>
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
  );
}

function EventDetailPage() {
  const { event } = Route.useLoaderData();
  const mode: "prediction" | "odds" = event.mode === "odds" ? "odds" : "prediction";
  const { data: prediction, isLoading } = useCurrentPrediction(event.id, mode);
  const isResolved = event.status === "resolved";
  const { data: resolution } = useQuery({
    queryKey: ["event-resolution", event.id],
    queryFn: () => fetchEventResolution(event.id),
    enabled: isResolved,
    staleTime: 5 * 60_000,
  });
  const [sheetOpen, setSheetOpen] = useState(false);

  const domainId = (DOMAINS as string[]).includes(event.domain)
    ? (event.domain as DomainId)
    : null;

  const ranked = prediction?.ranked_outcomes ?? [];
  const top = ranked[0] ?? null;
  const others = ranked.slice(1);
  const topPct = top?.probability != null ? Math.round(top.probability) : null;

  return (
    <div className="flex min-h-full flex-col" style={{ background: "var(--bg)" }}>
      {domainId && <DomainDisclaimer domain={domainId} />}
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 pt-3 pb-2 sm:px-6">
        <article className="min-w-0">
          {isResolved && resolution && (
            <div className="mb-4">
              <EventResolvedBanner
                correct={resolution.top_pick_correct === true}
                actualOutcome={resolution.actual_outcome}
                topPickAtTime={top?.outcome_label ?? null}
                topPickPct={top?.probability ?? null}
              />
            </div>
          )}

          <EventHero
            event={event}
            topPickLabel={top?.outcome_label ?? null}
            topPickPct={topPct}
          />

          {top ? (
            <ReasoningCard pick={top} rank={1} />
          ) : isLoading ? (
            <div className="h-32 animate-pulse rounded-2xl" style={{ background: "var(--bg-card)" }} />
          ) : (
            <p
              className="rounded-lg p-4 font-body text-sm mb-6"
              style={{ border: "1px dashed var(--border-soft)", color: "var(--ink-soft)" }}
            >
              Prophiq is thinking — check back in a few minutes.
            </p>
          )}

          {others.length > 0 && <OtherContenders picks={others} />}

          <MethodologyCard />

          {domainId && (
            <RelatedEvents domain={domainId} excludeId={event.id} limit={3} />
          )}

          <p className="disclaimer">
            Forecasts are informational only. Markets coverage is not financial
            advice. We do not endorse any candidate or party. 18+ where applicable.
          </p>
        </article>
      </div>

      <StickyBottomCTA onAskClick={() => setSheetOpen(true)} />
      {sheetOpen && <ChatSheet eventId={event.id} onClose={() => setSheetOpen(false)} />}
    </div>
  );
}
