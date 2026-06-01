import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteShell } from "@/components/site/SiteShell";
import { DomainDisclaimer } from "@/components/site/DisclaimerBanner";
import { fetchDomainAccuracy } from "@/lib/queries";
import { DOMAINS, DOMAIN_LABEL, type DomainId } from "@/lib/types";

export const Route = createFileRoute("/$domain/track-record")({
  head: () => ({
    meta: [
      { title: "Track record — Prophiq" },
      { name: "description", content: "Historical accuracy of Prophiq consensus predictions in this domain." },
    ],
  }),
  beforeLoad: ({ params }) => {
    if (!(DOMAINS as string[]).includes(params.domain)) throw notFound();
  },
  component: TrackRecordPage,
});

function TrackRecordPage() {
  const { domain } = Route.useParams();
  const domainId = domain as DomainId;
  const { data, isLoading } = useQuery({
    queryKey: ["accuracy", domainId],
    queryFn: () => fetchDomainAccuracy(domainId, 50),
    staleTime: 5 * 60_000,
  });

  const rows = data ?? [];
  const total = rows.length;
  const topHits = rows.filter((r) => r.top_pick_correct === true).length;
  const top3 = rows.reduce((acc, r) => acc + (r.picks_in_top_3 ?? 0), 0);
  const top5 = rows.reduce((acc, r) => acc + (r.picks_in_top_5 ?? 0), 0);

  return (
    <SiteShell>
      <DomainDisclaimer domain={domainId} />

      <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6 sm:pt-16">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-amber)]">
          {DOMAIN_LABEL[domainId]} — track record
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--brand-ink)] sm:text-4xl">
          How Prophiq has performed
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
          Resolved {DOMAIN_LABEL[domainId].toLowerCase()} events scored against actual outcomes.
          Top pick = the model's #1 ranked outcome was the real result.
        </p>
        <div className="mt-3">
          <Link
            to="/$domain"
            params={{ domain: domainId }}
            className="text-sm text-slate-600 hover:text-[var(--brand-ink)]"
          >
            ← Back to {DOMAIN_LABEL[domainId].toLowerCase()} predictions
          </Link>
        </div>
      </section>

      <section className="mx-auto mt-8 max-w-6xl px-4 sm:px-6">
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-[var(--brand-border)] bg-white" />
            ))}
          </div>
        ) : total === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--brand-border)] bg-white p-6 text-sm text-slate-600">
            No resolved events yet. Track record will populate as events resolve and Prophiq scores them.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Events scored" value={String(total)} />
              <StatCard
                label="Top pick correct"
                value={`${topHits} / ${total}`}
                hint={`${Math.round((topHits / total) * 100)}%`}
              />
              <StatCard label="Picks in top 3" value={String(top3)} hint="cumulative across events" />
              <StatCard label="Picks in top 5" value={String(top5)} hint="cumulative across events" />
            </div>

            <div className="mt-8 overflow-x-auto rounded-xl border border-[var(--brand-border)] bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--brand-border)] bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Event</th>
                    <th className="px-4 py-3 text-left font-semibold">Resolved</th>
                    <th className="px-4 py-3 text-left font-semibold">Top pick</th>
                    <th className="px-4 py-3 text-left font-semibold">Grade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--brand-border)]">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 align-top">
                        {r.event ? (
                          <Link
                            to="/$domain/events/$slug"
                            params={{ domain: domainId, slug: r.event.slug }}
                            className="font-medium text-[var(--brand-ink)] hover:underline decoration-[var(--brand-amber)] decoration-2 underline-offset-2"
                          >
                            {r.event.title}
                          </Link>
                        ) : (
                          <span className="text-slate-400">(event removed)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-500">
                        {formatDate(r.scored_at)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {r.top_pick_correct === true ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            ✓ Correct
                          </span>
                        ) : r.top_pick_correct === false ? (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            Missed
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <GradeBadge grade={r.accuracy_grade} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </SiteShell>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--brand-border)] bg-white p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-[var(--brand-ink)]">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function GradeBadge({ grade }: { grade: "excellent" | "good" | "mixed" | "poor" | null }) {
  if (!grade) return <span className="text-xs text-slate-400">—</span>;
  const cls: Record<string, string> = {
    excellent: "bg-emerald-50 text-emerald-700",
    good: "bg-sky-50 text-sky-700",
    mixed: "bg-amber-50 text-amber-800",
    poor: "bg-rose-50 text-rose-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls[grade]}`}>
      {grade}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
