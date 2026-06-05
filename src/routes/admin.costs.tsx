import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  adminCostSummary,
  adminCostDaily,
  adminCostRecent,
  adminCostPricing,
  formatCostMinor,
} from "@/lib/admin/costs";

export const Route = createFileRoute("/admin/costs")({
  head: () => ({
    meta: [
      { title: "Costs — Admin — Prophiq" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: CostsPage,
});

type PeriodKey = "7d" | "30d" | "90d";

function periodRange(key: PeriodKey): { start: string; end: string; label: string } {
  const end = new Date();
  const days = key === "7d" ? 7 : key === "30d" ? 30 : 90;
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString(), label: `Last ${days} days` };
}

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

function CostsPage() {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [domain, setDomain] = useState<string>("");
  const range = useMemo(() => periodRange(period), [period]);

  const summaryQ = useQuery({
    queryKey: ["admin", "costs", "summary", range.start, range.end, domain],
    queryFn: () => adminCostSummary(range.start, range.end, domain || null),
  });
  const dailyQ = useQuery({
    queryKey: ["admin", "costs", "daily", range.start, range.end, domain],
    queryFn: () => adminCostDaily(range.start, range.end, domain || null),
  });
  const recentQ = useQuery({
    queryKey: ["admin", "costs", "recent"],
    queryFn: () => adminCostRecent(100),
  });
  const pricingQ = useQuery({
    queryKey: ["admin", "costs", "pricing"],
    queryFn: () => adminCostPricing(),
  });

  const summary = summaryQ.data ?? [];
  const totalCost = summary.reduce((a, r) => a + Number(r.total_cost_minor || 0), 0);
  const totalCalls = summary.reduce((a, r) => a + (r.n_calls || 0), 0);
  const totalErrors = summary.reduce((a, r) => a + (r.n_errors || 0), 0);
  const currency = summary[0]?.currency ?? "USD";

  // Aggregate daily totals across models for a simple bar chart.
  const dailyTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of dailyQ.data ?? []) {
      const key = row.day;
      map.set(key, (map.get(key) ?? 0) + Number(row.total_cost_minor || 0));
    }
    const entries = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    const max = entries.reduce((m, [, v]) => Math.max(m, v), 0);
    return { entries, max };
  }, [dailyQ.data]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)" }}>LLM costs</h1>
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            Best-effort cost audit from <code>llm_cost_events</code>. Hot path is never blocked by logging.
            Costs are computed at insert time from current <code>llm_pricing</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border" style={{ borderColor: "var(--border-soft)" }}>
            {(["7d", "30d", "90d"] as PeriodKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPeriod(k)}
                className="px-3 py-1.5 text-xs font-mono uppercase tracking-[0.15em]"
                style={{
                  background: period === k ? "var(--amber-strong)" : "transparent",
                  color: period === k ? "var(--bg)" : "var(--ink-soft)",
                }}
              >
                {k}
              </button>
            ))}
          </div>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="Filter domain"
            className="rounded-md border px-2 py-1.5 text-sm"
            style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)", color: "var(--ink)", width: 180 }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Total cost" value={formatCostMinor(totalCost, currency)} sub={range.label} />
        <Tile label="Calls" value={String(totalCalls)} sub={`${totalErrors} errors`} />
        <Tile
          label="Models"
          value={String(summary.length)}
          sub={summary.map((s) => s.model).join(" · ") || "—"}
        />
        <Tile
          label="Avg / call"
          value={totalCalls > 0 ? formatCostMinor(totalCost / totalCalls, currency) : "—"}
        />
      </div>

      {/* Per-model summary */}
      <section className="rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>By model</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ color: "var(--ink-soft)" }}>
              <tr className="text-left">
                {["Model", "Calls", "Errors", "In tk", "Out tk", "Cost", "Avg ms", "p95 ms"].map((h) => (
                  <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody style={{ color: "var(--ink)" }}>
              {summary.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center" style={{ color: "var(--ink-soft)" }}>
                  {summaryQ.isLoading ? "loading…" : "No cost events in this window."}
                </td></tr>
              ) : summary.map((r) => (
                <tr key={r.model} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                  <td className="px-4 py-2">{r.model}</td>
                  <td className="px-4 py-2 font-mono">{r.n_calls}</td>
                  <td className="px-4 py-2 font-mono" style={{ color: r.n_errors > 0 ? "var(--danger, #b91c1c)" : "var(--ink-soft)" }}>
                    {r.n_errors}
                  </td>
                  <td className="px-4 py-2 font-mono">{Number(r.total_input_tk).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono">{Number(r.total_output_tk).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono">{formatCostMinor(r.total_cost_minor, r.currency ?? "USD")}</td>
                  <td className="px-4 py-2 font-mono">{r.avg_latency_ms ?? "—"}</td>
                  <td className="px-4 py-2 font-mono">{r.p95_latency_ms ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Daily totals */}
      <section className="rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>Daily spend</div>
        </div>
        <div className="p-4">
          {dailyTotals.entries.length === 0 ? (
            <div className="py-6 text-center text-sm" style={{ color: "var(--ink-soft)" }}>No data.</div>
          ) : (
            <div className="flex h-32 items-end gap-1">
              {dailyTotals.entries.map(([day, cost]) => {
                const h = dailyTotals.max > 0 ? Math.max(2, Math.round((cost / dailyTotals.max) * 100)) : 2;
                return (
                  <div key={day} className="flex flex-1 flex-col items-center gap-1" title={`${day}: ${formatCostMinor(cost, currency)}`}>
                    <div
                      className="w-full rounded-sm"
                      style={{ height: `${h}%`, background: "var(--amber-strong)", opacity: 0.85 }}
                    />
                    <div className="font-mono text-[9px]" style={{ color: "var(--ink-soft)" }}>
                      {day.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Pricing snapshot */}
      <section className="rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>Pricing snapshot</div>
          <div className="text-xs" style={{ color: "var(--ink-soft)" }}>
            cents per 1M tokens. Edit via SQL <code>UPDATE public.llm_pricing</code>.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ color: "var(--ink-soft)" }}>
              <tr className="text-left">
                {["Model", "Input ¢/1M", "Output ¢/1M", "Currency", "Effective from", "Notes"].map((h) => (
                  <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody style={{ color: "var(--ink)" }}>
              {(pricingQ.data ?? []).map((r) => (
                <tr key={r.model} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                  <td className="px-4 py-2">{r.model}</td>
                  <td className="px-4 py-2 font-mono">{r.input_per_million_minor}</td>
                  <td className="px-4 py-2 font-mono">{r.output_per_million_minor}</td>
                  <td className="px-4 py-2 font-mono">{r.currency}</td>
                  <td className="px-4 py-2 font-mono" style={{ color: "var(--ink-soft)" }}>
                    {new Date(r.effective_from).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2" style={{ color: "var(--ink-soft)" }}>{r.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent */}
      <section className="rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>Recent calls</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ color: "var(--ink-soft)" }}>
              <tr className="text-left">
                {["When", "Model", "Domain", "In", "Out", "ms", "Cost", "Status"].map((h) => (
                  <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody style={{ color: "var(--ink)" }}>
              {(recentQ.data ?? []).length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center" style={{ color: "var(--ink-soft)" }}>No calls yet.</td></tr>
              ) : (recentQ.data ?? []).map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                  <td className="px-4 py-2 font-mono" style={{ color: "var(--ink-soft)" }}>
                    {new Date(r.called_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{r.model}</td>
                  <td className="px-4 py-2" style={{ color: "var(--ink-soft)" }}>{r.domain ?? "—"}</td>
                  <td className="px-4 py-2 font-mono">{r.input_tokens ?? "—"}</td>
                  <td className="px-4 py-2 font-mono">{r.output_tokens ?? "—"}</td>
                  <td className="px-4 py-2 font-mono">{r.latency_ms ?? "—"}</td>
                  <td className="px-4 py-2 font-mono">{formatCostMinor(r.est_cost_minor, r.currency ?? "USD")}</td>
                  <td className="px-4 py-2 font-mono" style={{ color: r.had_error ? "var(--danger, #b91c1c)" : "var(--ink-soft)" }}>
                    {r.had_error ? `error: ${(r.error_message ?? "").slice(0, 60)}` : "ok"}
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
