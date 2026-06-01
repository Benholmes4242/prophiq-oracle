import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/SiteShell";
import { DomainCard } from "@/components/site/DomainCard";
import { EventCard } from "@/components/site/EventCard";
import { useDomainSummaries, useRecentPicks } from "@/hooks/useEvents";
import { DOMAINS } from "@/lib/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Prophiq — Multi-model consensus predictions" },
      {
        name: "description",
        content:
          "Prophiq runs three frontier AI models in parallel on every upcoming event in sport, politics, markets, and entertainment — then publishes the consensus pick with reasons.",
      },
      { property: "og:title", content: "Prophiq — Multi-model consensus predictions" },
      {
        property: "og:description",
        content:
          "Sport, politics, markets, entertainment. Three models, one consensus, every event.",
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const summaries = useDomainSummaries();
  const recent = useRecentPicks(6);

  const upcomingByDomain = new Map(
    (summaries.data ?? []).map((s) => [s.domain, s.upcoming_count]),
  );

  return (
    <SiteShell>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--brand-amber)_20%,transparent),transparent_70%)]"
        />
        <div className="mx-auto max-w-6xl px-4 pb-12 pt-16 sm:px-6 sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-border)] bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-amber)]" />
            Three models. One consensus. Every event.
          </span>
          <h1 className="mt-5 max-w-3xl text-4xl font-bold tracking-tight text-[var(--brand-ink)] sm:text-5xl md:text-6xl">
            Predictions you can{" "}
            <span className="text-[var(--brand-amber)]">interrogate</span>, not just read.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Prophiq runs frontier AI models in parallel on every upcoming event in sport,
            politics, markets, and entertainment — then publishes the consensus pick with the
            reasoning behind it. Ask follow-ups on any event.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              to="/predictions"
              className="inline-flex items-center rounded-full bg-[var(--brand-ink)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-px"
            >
              Browse predictions
            </Link>
            <Link
              to="/ask"
              className="inline-flex items-center rounded-full bg-[var(--brand-amber)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-px"
            >
              Ask a question →
            </Link>
          </div>
        </div>
      </section>

      {/* Domain cards */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-xl font-semibold tracking-tight text-[var(--brand-ink)] sm:text-2xl">
            Four domains
          </h2>
          <Link
            to="/predictions"
            className="text-sm font-medium text-slate-600 hover:text-[var(--brand-ink)]"
          >
            See all →
          </Link>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DOMAINS.map((d) => (
            <DomainCard key={d} domain={d} upcomingCount={upcomingByDomain.get(d)} />
          ))}
        </div>
      </section>

      {/* Recent picks rail */}
      <section className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-[var(--brand-ink)] sm:text-2xl">
              Recent picks
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Fresh consensus predictions across every domain.
            </p>
          </div>
          <Link
            to="/predictions"
            className="text-sm font-medium text-slate-600 hover:text-[var(--brand-ink)]"
          >
            All predictions →
          </Link>
        </div>

        <div className="mt-5">
          {recent.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-44 animate-pulse rounded-xl border border-[var(--brand-border)] bg-white"
                />
              ))}
            </div>
          ) : recent.isError ? (
            <p className="rounded-lg border border-[var(--brand-border)] bg-white p-6 text-sm text-slate-600">
              Couldn't load recent picks. Try refreshing.
            </p>
          ) : (recent.data?.length ?? 0) === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--brand-border)] bg-white p-6 text-sm text-slate-600">
              No predictions yet. Check back soon.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {recent.data!.map(({ event, prediction }) => (
                <EventCard key={event.id} event={event} prediction={prediction} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* How it works strip */}
      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6">
        <div className="rounded-2xl border border-[var(--brand-border)] bg-white p-8">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Discover",
                body: "An autonomous cron pulls upcoming events from across the web every few hours.",
              },
              {
                step: "02",
                title: "Predict in parallel",
                body: "Three frontier AI models research each event independently and rank the outcomes.",
              },
              {
                step: "03",
                title: "Reach consensus",
                body: "A weighted Borda count fuses the rankings — and surfaces how much the models agree.",
              },
            ].map((s) => (
              <div key={s.step}>
                <span className="text-xs font-mono text-[var(--brand-amber)]">{s.step}</span>
                <h3 className="mt-2 text-base font-semibold text-[var(--brand-ink)]">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
