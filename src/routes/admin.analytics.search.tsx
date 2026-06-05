import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  adminSearchTopQueries,
  adminSearchCoverageGaps,
  adminSearchSummary,
} from "@/lib/admin/search";

export const Route = createFileRoute("/admin/analytics/search")({
  head: () => ({
    meta: [
      { title: "Search analytics — Admin — Prophiq" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SearchAnalyticsPage,
});

const PERIODS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: "var(--ink)" }}>{value}</div>
      {sub && <div className="mt-0.5 text-xs" style={{ color: "var(--ink-soft)" }}>{sub}</div>}
    </div>
  );
}

function SearchAnalyticsPage() {
  const [days, setDays] = useState<number>(7);

  const summaryQ = useQuery({
    queryKey: ["admin", "search", "summary", days],
    queryFn: () => adminSearchSummary(days),
  });
  const topQ = useQuery({
    queryKey: ["admin", "search", "top", days],
    queryFn: () => adminSearchTopQueries(days, 100),
  });
  const gapsQ = useQuery({
    queryKey: ["admin", "search", "gaps", days],
    queryFn: () => adminSearchCoverageGaps(days, 50),
  });

  const summary = summaryQ.data;
  const conversion = summary ? `${(summary.conversion_rate * 100).toFixed(1)}%` : "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--ink-faint)", fontWeight: 600 }}>ADMIN</p>
          <h1 className="font-display tracking-[-0.03em]" style={{ fontWeight: 700, fontSize: 28, lineHeight: 1 }}>
            Search analytics<span style={{ color: "var(--amber)" }}>.</span>
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-soft)" }}>
            What users are asking, what we match vs generate, and where coverage is thin.
          </p>
        </div>
        <div className="flex gap-1 rounded-md border p-0.5" style={{ borderColor: "var(--border-soft)" }}>
          {PERIODS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setDays(p.days)}
              className="rounded px-3 py-1.5 font-mono text-[11px]"
              style={{
                background: days === p.days ? "var(--amber-strong)" : "transparent",
                color: days === p.days ? "var(--bg)" : "var(--ink)",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Total queries" value={summary ? summary.total.toLocaleString() : "—"} />
        <Tile label="Conversion" value={conversion} sub="matched + generated / total" />
        <Tile label="Matched" value={String(summary?.by_result?.matched ?? 0)} />
        <Tile label="Generated" value={String(summary?.by_result?.generated ?? 0)} />
        <Tile label="Rejected" value={String(summary?.by_result?.rejected ?? 0)} />
        <Tile label="Failed" value={String(summary?.by_result?.failed ?? 0)} />
        <Tile
          label="Top domain"
          value={(() => {
            const d = summary?.by_domain ?? {};
            const entries = Object.entries(d).sort((a, b) => b[1] - a[1]);
            return entries[0]?.[0] ?? "—";
          })()}
          sub={(() => {
            const d = summary?.by_domain ?? {};
            const entries = Object.entries(d).sort((a, b) => b[1] - a[1]);
            return entries[0] ? `${entries[0][1]} queries` : undefined;
          })()}
        />
        <Tile
          label="Unclassified"
          value={String(summary?.by_domain?.unclassified ?? 0)}
          sub="no domain resolved"
        />
      </div>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-[18px]" style={{ fontWeight: 600 }}>
            Top queries
          </h2>
          <span className="font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
            Clustered by normalized text · {topQ.data?.length ?? 0} clusters
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
          <table className="w-full text-left text-[13px]">
            <thead className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-soft)" }}>
              <tr>
                <th className="px-3 py-2">Sample question</th>
                <th className="px-3 py-2 text-right">Hits</th>
                <th className="px-3 py-2 text-right">Matched</th>
                <th className="px-3 py-2 text-right">Generated</th>
                <th className="px-3 py-2 text-right">Rejected</th>
                <th className="px-3 py-2 text-right">Failed</th>
                <th className="px-3 py-2">Domains</th>
              </tr>
            </thead>
            <tbody>
              {topQ.isLoading && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm" style={{ color: "var(--ink-soft)" }}>Loading…</td></tr>
              )}
              {!topQ.isLoading && (topQ.data?.length ?? 0) === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm" style={{ color: "var(--ink-soft)" }}>No queries in window.</td></tr>
              )}
              {topQ.data?.map((r) => (
                <tr key={r.question_normalized} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                  <td className="px-3 py-2">
                    <div className="truncate" style={{ color: "var(--ink)" }}>{r.sample_question}</div>
                    <div className="truncate font-mono text-[10px]" style={{ color: "var(--ink-faint)" }}>{r.question_normalized}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.hits}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.matched}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.generated}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.rejected}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.failed}</td>
                  <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
                    {(r.domains ?? []).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-[18px]" style={{ fontWeight: 600 }}>
            Coverage gaps
          </h2>
          <span className="font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
            Rejected + failed clusters · what users want that we're not serving
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
          <table className="w-full text-left text-[13px]">
            <thead className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-soft)" }}>
              <tr>
                <th className="px-3 py-2">Sample question</th>
                <th className="px-3 py-2 text-right">Hits</th>
                <th className="px-3 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {gapsQ.isLoading && (
                <tr><td colSpan={3} className="px-3 py-8 text-center text-sm" style={{ color: "var(--ink-soft)" }}>Loading…</td></tr>
              )}
              {!gapsQ.isLoading && (gapsQ.data?.length ?? 0) === 0 && (
                <tr><td colSpan={3} className="px-3 py-8 text-center text-sm" style={{ color: "var(--ink-soft)" }}>No rejected or failed queries. Nice.</td></tr>
              )}
              {gapsQ.data?.map((r) => (
                <tr key={r.question_normalized} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                  <td className="px-3 py-2">
                    <div className="truncate" style={{ color: "var(--ink)" }}>{r.sample_question}</div>
                    <div className="truncate font-mono text-[10px]" style={{ color: "var(--ink-faint)" }}>{r.question_normalized}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.hits}</td>
                  <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
                    {new Date(r.last_seen).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
