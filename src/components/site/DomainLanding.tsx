// Shared per-domain landing page skeleton. Full event grids land in step 5;
// for now it shows the upcoming-count, the right regulatory disclaimer, and
// links to the predictions feed filtered by domain.

import { Link } from "@tanstack/react-router";
import { useEvents } from "@/hooks/useEvents";
import { EventCard } from "./EventCard";
import { DomainDisclaimer } from "./DisclaimerBanner";
import { DOMAIN_LABEL, DOMAIN_TAGLINE, type DomainId } from "@/lib/types";

export function DomainLanding({ domain }: { domain: DomainId }) {
  const events = useEvents({ domain, status: "scheduled", limit: 9, order: "starts_at_asc" });

  return (
    <>
      <DomainDisclaimer domain={domain} />


      <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6 sm:pt-16">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-amber-text)]">
          {DOMAIN_LABEL[domain]}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--brand-ink)] sm:text-4xl">
          {DOMAIN_TAGLINE[domain]}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
          Upcoming {DOMAIN_LABEL[domain].toLowerCase()} events with multi-model consensus
          predictions, refreshed automatically.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            to="/$domain/track-record"
            params={{ domain }}
            className="inline-flex items-center rounded-full border border-[var(--brand-border)] bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:text-[var(--brand-ink)]"
          >
            Track record →
          </Link>
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-6xl px-4 sm:px-6">
        {events.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-44 animate-pulse rounded-xl border border-[var(--brand-border)] bg-white"
              />
            ))}
          </div>
        ) : (events.data?.length ?? 0) === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--brand-border)] bg-white p-6 text-sm text-slate-600">
            No upcoming {DOMAIN_LABEL[domain].toLowerCase()} events scheduled. The discovery cron runs every few hours.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.data!.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

