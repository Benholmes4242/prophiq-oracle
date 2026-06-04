// Event detail page. SSR-rendered for SEO with JSON-LD Event structured
// data. AppHeader comes from __root.tsx; this page provides its own bottom
// UX (disclaimer + sticky CTA + chat sheet) and does NOT render SiteShell.

import { useEffect, useState } from "react";
import {
  createFileRoute,
  notFound,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DomainDisclaimer } from "@/components/site/DisclaimerBanner";
import { EventResolvedBanner } from "@/components/site/EventResolvedBanner";
import { EventHero } from "@/components/site/EventHero";
import { CallSection, FIELD_LABEL_PATTERN } from "@/components/site/CallSection";
import { Reasoning } from "@/components/site/Reasoning";
import { RelatedEvents } from "@/components/site/RelatedEvents";
import { StickyBottomCTA } from "@/components/site/StickyBottomCTA";
import { ChatSheet } from "@/components/site/ChatSheet";
import { SubQuestionCard } from "@/components/event/SubQuestionCard";
import { ForecastGeneratingScreen } from "@/components/event/ForecastGeneratingScreen";
import {
  fetchEventFamilyBySlug,
  fetchEventResolution,
  type EventFamily,
} from "@/lib/queries";
import { triggerOnDemandPrediction } from "@/lib/triggers";
import { getPublicBaseUrl } from "@/lib/publicUrl";
import { classifyEvent } from "@/lib/subcategory";
import { DOMAINS, DOMAIN_LABEL } from "@/lib/types";
import type { DomainId, EventRow, RankedOutcome } from "@/lib/types";

export const Route = createFileRoute("/$domain/events/$slug")({
  loader: async ({ params }) => {
    let family = await fetchEventFamilyBySlug(params.slug);
    // Defensive fallback: if the RPC returns null but the slug exists as a
    // child, look up its parent slug directly and retry from there.
    if (!family) {
      const { supabase } = await import("@/lib/supabase");
      const { data: row } = await supabase
        .from("events")
        .select("slug, parent_event_id")
        .eq("slug", params.slug)
        .maybeSingle();
      if (row?.parent_event_id) {
        const { data: parentRow } = await supabase
          .from("events")
          .select("slug, domain")
          .eq("id", row.parent_event_id)
          .maybeSingle();
        if (parentRow?.slug) {
          family = await fetchEventFamilyBySlug(parentRow.slug);
        }
      }
    }
    if (!family) throw notFound();
    // Child slug → redirect to the parent's canonical URL.
    if (family.resolved_from_child || family.parent.event.slug !== params.slug) {
      throw redirect({
        to: "/$domain/events/$slug",
        params: {
          domain: family.parent.event.domain,
          slug: family.parent.event.slug,
        },
        replace: true,
      });
    }
    const event = family.parent.event;
    if (event.domain !== params.domain) throw notFound();
    return { family, event };
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

function buildCallHeading(picks: RankedOutcome[], topPickLabel: string): string {
  const pct = (p?: number) => Math.round((p ?? 0) > 1 ? (p as number) : (p ?? 0) * 100);
  const topPct = pct(picks[0]?.probability);
  const named = picks.filter(
    (p) => !FIELD_LABEL_PATTERN.test((p.outcome_label ?? "").trim()),
  );
  const namedSum = named.reduce((s, p) => s + pct(p.probability), 0);

  if (topPct < 30 && namedSum < 80) {
    return `${topPickLabel} leads a wide field.`;
  }
  if (topPct >= 75) return `${topPickLabel}, with strong conviction.`;
  if (topPct >= 50) return `A clear lean toward ${topPickLabel.toLowerCase()}.`;
  return `${topPickLabel} as the most likely outcome.`;
}

function ParentEventEyebrows({
  event,
  ranked,
}: {
  event: EventRow;
  ranked: RankedOutcome[];
}) {
  const meta = (event.metadata ?? {}) as Record<string, unknown>;
  const fieldSizeRaw = meta.field_size;
  const fieldSize =
    typeof fieldSizeRaw === "number"
      ? fieldSizeRaw
      : typeof fieldSizeRaw === "string"
        ? Number(fieldSizeRaw)
        : null;
  const showFieldOf = fieldSize != null && Number.isFinite(fieldSize) && fieldSize >= 10;

  const pct = (p?: number) =>
    Math.round((p ?? 0) > 1 ? (p as number) : (p ?? 0) * 100);
  const named = ranked.filter(
    (p) => !FIELD_LABEL_PATTERN.test((p.outcome_label ?? "").trim()),
  );
  const topPct = pct(named[0]?.probability);
  const secondPct = pct(named[1]?.probability);
  const dominant = secondPct > 0 && topPct >= 2 * secondPct;
  const lead = topPct - secondPct;

  if (!showFieldOf && !dominant) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      {showFieldOf && (
        <span
          className="font-mono text-[10px] font-bold tracking-[0.2em]"
          style={{ color: "var(--amber-2)" }}
        >
          FIELD OF {fieldSize}
        </span>
      )}
      {dominant && (
        <span
          className="font-mono text-[10px] font-bold tracking-[0.2em]"
          style={{ color: "var(--amber-2)" }}
        >
          STRONGEST PICK BY {lead} POINTS
        </span>
      )}
    </div>
  );
}


function EventDetailPage() {
  const { family, event } = Route.useLoaderData();
  const prediction = family.parent.prediction;
  const children = family.children ?? [];
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
  const topPickLabel =
    top?.outcome_label ?? top?.outcome_id ?? "the most likely outcome";

  const subcategoryRaw = domainId ? classifyEvent(event.title, domainId) : null;
  const subcategory =
    subcategoryRaw && subcategoryRaw !== "All" && subcategoryRaw !== "Other"
      ? subcategoryRaw
      : null;

  return (
    <div className="flex min-h-full flex-col" style={{ background: "var(--bg)" }}>
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

          <ParentEventEyebrows event={event} ranked={ranked} />

          <EventHero event={event} subcategory={subcategory} />

          {ranked.length > 0 ? (
            <CallSection
              picks={ranked}
              heading={buildCallHeading(ranked, topPickLabel)}
              domain={domainId}
              generatedAt={prediction?.generated_at ?? null}
              showFrequentistFraming={ranked.length >= 3}
            />
          ) : (
            <p
              className="rounded-lg p-4 font-body text-sm mb-6"
              style={{ border: "1px dashed var(--border-soft)", color: "var(--ink-soft)" }}
            >
              Prophiq is thinking - check back in a few minutes.
            </p>
          )}


          {top && (
            <Reasoning
              pickLabel={topPickLabel}
              reasons={top.reasons ?? []}
            />
          )}

          {children.length > 0 && (
            <section className="mt-6">
              <div className="section-row">
                <span className="section-eyebrow">OTHER FORECASTS ON THIS EVENT</span>
                <span className="section-rule" />
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {children.map((c: EventFamily["children"][number]) => (
                  <SubQuestionCard
                    key={c.event.id}
                    event={c.event}
                    prediction={c.prediction}
                  />
                ))}
              </div>
            </section>
          )}



          {domainId && (
            <RelatedEvents domain={domainId} excludeId={event.id} limit={3} />
          )}

          {domainId && <DomainDisclaimer domain={domainId} />}

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
