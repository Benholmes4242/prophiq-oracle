import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SiteShell } from "@/components/site/SiteShell";
import { EventCard } from "@/components/site/EventCard";
import { fetchEventsWithPredictions } from "@/lib/queries";
import {
  DOMAINS,
  DOMAIN_LABEL,
  type DomainId,
  type EventMode,
  type EventSource,
  type EventStatus,
} from "@/lib/types";

const PAGE_CAP = 50;

const domainEnum = z.enum(["sport", "politics", "markets", "entertainment"]);
const statusEnum = z.enum(["upcoming", "live", "resolved"]);
const modeEnum = z.enum(["prediction", "odds"]);
const sourceEnum = z.enum(["discovered", "user_submitted"]);

const searchSchema = z.object({
  domain: fallback(domainEnum.array(), []).default([]),
  status: fallback(statusEnum, "upcoming").default("upcoming"),
  mode: fallback(modeEnum, "prediction").default("prediction"),
  source: fallback(sourceEnum.optional(), undefined),
});

type StatusTab = z.infer<typeof statusEnum>;

const STATUS_LABEL: Record<StatusTab, string> = {
  upcoming: "Upcoming",
  live: "Live",
  resolved: "Resolved",
};

function mapStatusTab(tab: StatusTab): EventStatus | EventStatus[] {
  if (tab === "upcoming") return "scheduled";
  if (tab === "live") return "live";
  return "resolved";
}

export const Route = createFileRoute("/predictions")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "All predictions — Prophiq" },
      {
        name: "description",
        content:
          "Browse every consensus prediction across sport, politics, markets, and entertainment.",
      },
    ],
  }),
  component: PredictionsPage,
});

type SearchParams = z.infer<typeof searchSchema>;

function PredictionsPage() {
  const search = Route.useSearch() as SearchParams;
  const navigate = useNavigate({ from: "/predictions" });

  const filter = {
    domain: search.domain.length ? (search.domain as DomainId[]) : undefined,
    status: mapStatusTab(search.status),
    mode: search.mode as EventMode,
    source: search.source as EventSource | undefined,
    order:
      search.status === "resolved"
        ? ("starts_at_desc" as const)
        : ("starts_at_asc" as const),
    limit: PAGE_CAP,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["events-feed", filter],
    queryFn: () => fetchEventsWithPredictions(filter, search.mode),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const events = data ?? [];
  const hasFilters =
    search.domain.length > 0 ||
    search.status !== "upcoming" ||
    search.mode !== "prediction" ||
    !!search.source;

  function toggleDomain(d: DomainId) {
    const next = search.domain.includes(d)
      ? search.domain.filter((x) => x !== d)
      : [...search.domain, d];
    navigate({ search: (p) => ({ ...p, domain: next }) });
  }

  return (
    <SiteShell>
      <section className="mx-auto max-w-7xl px-4 pb-20 pt-10 sm:px-6">
        <header className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--brand-ink)] sm:text-4xl">
            All predictions
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Filter the consensus feed by domain, mode, source, and status.
          </p>
        </header>

        <div className="mb-8 space-y-4 rounded-xl border border-[var(--brand-border)] bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.02)]">
          <FilterRow label="Domain">
            {DOMAINS.map((d) => (
              <Pill key={d} active={search.domain.includes(d)} onClick={() => toggleDomain(d)}>
                {DOMAIN_LABEL[d]}
              </Pill>
            ))}
            {search.domain.length > 0 && (
              <button
                type="button"
                onClick={() => navigate({ search: (p) => ({ ...p, domain: [] }) })}
                className="text-xs text-slate-500 underline-offset-2 hover:underline"
              >
                Clear
              </button>
            )}
          </FilterRow>

          <FilterRow label="Mode">
            {(["prediction", "odds"] as const).map((m) => (
              <Pill
                key={m}
                active={search.mode === m}
                onClick={() => navigate({ search: (p) => ({ ...p, mode: m }) })}
              >
                {m === "prediction" ? "Prediction" : "Odds"}
              </Pill>
            ))}
          </FilterRow>

          <FilterRow label="Source">
            {(["discovered", "user_submitted"] as const).map((s) => {
              const active = search.source === s;
              return (
                <Pill
                  key={s}
                  active={active}
                  onClick={() =>
                    navigate({
                      search: (p) => ({ ...p, source: active ? undefined : s }),
                    })
                  }
                >
                  {s === "discovered" ? "Discovered" : "Community"}
                </Pill>
              );
            })}
          </FilterRow>
        </div>

        <div className="mb-6 flex items-center gap-1 border-b border-[var(--brand-border)]">
          {(Object.keys(STATUS_LABEL) as StatusTab[]).map((s) => {
            const active = search.status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => navigate({ search: (p) => ({ ...p, status: s }) })}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "border-[var(--brand-amber)] text-[var(--brand-ink)]"
                    : "border-transparent text-slate-500 hover:text-[var(--brand-ink)]"
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>

        {error ? (
          <EmptyState title="Couldn't load predictions" body={(error as Error).message} />
        ) : isLoading && events.length === 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-xl border border-[var(--brand-border)] bg-slate-50"
              />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            title="No predictions match these filters."
            body={
              hasFilters
                ? "Clear filters to see all upcoming events."
                : "Check back soon — the discovery cron runs every few hours."
            }
            action={
              hasFilters ? (
                <Link
                  to="/predictions"
                  search={{ domain: [], status: "upcoming", mode: "prediction", source: undefined }}
                  className="inline-flex items-center rounded-md bg-[var(--brand-ink)] px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Clear filters
                </Link>
              ) : null
            }
          />
        ) : (
          <>
            <p className="mb-4 text-xs text-slate-500">
              Showing {events.length}
              {events.length === PAGE_CAP ? "+" : ""} {STATUS_LABEL[search.status].toLowerCase()} events
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {events.map(({ event, prediction }) => (
                <EventCard key={event.id} event={event} prediction={prediction} />
              ))}
            </div>
          </>
        )}
      </section>
    </SiteShell>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-[var(--brand-ink)] bg-[var(--brand-ink)] text-white"
          : "border-[var(--brand-border)] bg-white text-slate-600 hover:border-slate-300 hover:text-[var(--brand-ink)]"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--brand-border)] bg-white py-16 text-center">
      <h2 className="text-lg font-semibold text-[var(--brand-ink)]">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
