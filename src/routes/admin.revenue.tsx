import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  adminRevenueMetrics,
  adminMrrHistory,
  adminPlanDistribution,
  adminTopCustomers,
  adminRevenueSync,
  formatMinor,
  type StripeSyncResult,
} from "@/lib/admin/revenue";
import type { AdminRole } from "@/lib/admin/queries";
import { Route as AdminRoute } from "./admin";

export const Route = createFileRoute("/admin/revenue")({
  head: () => ({
    meta: [
      { title: "Revenue — Admin — Prophiq" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RevenuePage,
});

type PeriodKey = "this_month" | "last_month" | "last_90d";

function periodRange(key: PeriodKey): { start: string; end: string; label: string } {
  const now = new Date();
  const end = now.toISOString();
  if (key === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    return { start, end, label: "This month" };
  }
  if (key === "last_month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const e = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    return { start, end: e, label: "Last month" };
  }
  const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  return { start, end, label: "Last 90 days" };
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

function RevenuePage() {
  const ctx = AdminRoute.useRouteContext();
  const adminRole = (ctx as { adminRole?: AdminRole | null }).adminRole ?? null;
  const canSync = adminRole === "super_admin" || adminRole === "admin";

  const [periodKey, setPeriodKey] = useState<PeriodKey>("this_month");
  const period = useMemo(() => periodRange(periodKey), [periodKey]);

  const { data: metrics } = useQuery({
    queryKey: ["admin", "revenue", "metrics", period.start, period.end],
    queryFn: () => adminRevenueMetrics(period.start, period.end),
    refetchInterval: 60_000,
  });
  const { data: history = [] } = useQuery({
    queryKey: ["admin", "revenue", "mrr-history"],
    queryFn: () => adminMrrHistory(12),
    refetchInterval: 5 * 60_000,
  });
  const { data: distribution = [] } = useQuery({
    queryKey: ["admin", "revenue", "plan-distribution"],
    queryFn: () => adminPlanDistribution(),
    refetchInterval: 60_000,
  });
  const { data: top = [] } = useQuery({
    queryKey: ["admin", "revenue", "top-customers"],
    queryFn: () => adminTopCustomers(20),
    refetchInterval: 5 * 60_000,
  });

  const [stripeSync, setStripeSync] = useState<StripeSyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncErr, setSyncErr] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncErr(null);
    try {
      const r = await adminRevenueSync(period.start, period.end);
      setStripeSync(r);
    } catch (e) {
      setSyncErr((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const currency = metrics?.currency ?? "USD";
  const mrr = metrics?.mrr_minor ?? 0;
  const arr = mrr * 12;
  const maxMrr = Math.max(1, ...history.map((h) => h.mrr_minor));
  const distTotal = distribution.reduce((s, r) => s + r.sub_count, 0);
  const trialConv = metrics && metrics.trial_to_paid.trials_started > 0
    ? (metrics.trial_to_paid.converted / metrics.trial_to_paid.trials_started) * 100
    : null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
        Admin
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--ink)" }}>Revenue</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-soft)" }}>
            Local MRR from webhook-synced subscriptions. Use "Refresh from Stripe" for refund + recovery ground truth.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border p-0.5" style={{ borderColor: "var(--border-strong)" }}>
          {(["this_month", "last_month", "last_90d"] as PeriodKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setPeriodKey(k)}
              className="rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-ios-colors"
              style={{
                background: periodKey === k ? "var(--amber-strong)" : "transparent",
                color: periodKey === k ? "white" : "var(--ink)",
              }}
            >
              {periodRange(k).label}
            </button>
          ))}
        </div>
      </div>

      {/* Tiles */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="MRR" value={formatMinor(mrr, currency)} sub={`ARR ${formatMinor(arr, currency)}`} />
        <Tile label="Active" value={String(metrics?.active_count ?? "—")} sub={`${metrics?.trialing_count ?? 0} trialing · ${metrics?.past_due_count ?? 0} past due`} />
        <Tile label={`New (${period.label.toLowerCase()})`} value={String(metrics?.new_in_period ?? "—")} sub={`${metrics?.canceled_in_period ?? 0} churned`} />
        <Tile label="Trial → paid" value={trialConv != null ? `${trialConv.toFixed(0)}%` : "—"} sub={metrics ? `${metrics.trial_to_paid.converted} / ${metrics.trial_to_paid.trials_started}` : undefined} />
      </div>

      {/* MRR history */}
      <div className="mt-8 rounded-xl border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
          MRR (last 12 months)
        </div>
        <div className="text-xs" style={{ color: "var(--ink-soft)" }}>
          Reconstructed from current subscription rows. Historical plan changes not reflected.
        </div>
        <div className="mt-4 flex h-32 items-end gap-2">
          {history.map((h) => (
            <div key={h.month_start} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t"
                style={{
                  height: `${(h.mrr_minor / maxMrr) * 100}%`,
                  minHeight: 2,
                  background: "var(--amber-strong)",
                }}
                title={`${formatMinor(h.mrr_minor, currency)} · ${h.active_count} subs`}
              />
              <div className="font-mono text-[10px]" style={{ color: "var(--ink-soft)" }}>
                {new Date(h.month_start).toLocaleDateString(undefined, { month: "short" })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Plan distribution + Stripe sync */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
            Plan distribution
          </div>
          {distribution.length === 0 ? (
            <div className="py-6 text-center text-sm" style={{ color: "var(--ink-soft)" }}>No active plans.</div>
          ) : (
            <div className="space-y-2">
              {distribution.map((d) => {
                const pct = distTotal > 0 ? (d.sub_count / distTotal) * 100 : 0;
                return (
                  <div key={`${d.tier}-${d.cadence}`}>
                    <div className="flex justify-between text-sm">
                      <span style={{ color: "var(--ink)" }}>{d.tier} · {d.cadence}</span>
                      <span style={{ color: "var(--ink-soft)" }}>{d.sub_count} ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full" style={{ background: "var(--border-soft)" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--amber-strong)" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
              Stripe ground truth
            </div>
            {canSync && (
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-ios-colors hover:bg-[rgba(11,18,32,0.05)] disabled:opacity-50"
                style={{ borderColor: "var(--border-strong)", color: "var(--ink)" }}
              >
                {syncing ? "Syncing…" : "Refresh from Stripe"}
              </button>
            )}
          </div>
          {syncErr && (
            <div className="mt-3 text-xs" style={{ color: "#B91C1C" }}>{syncErr}</div>
          )}
          {!canSync && (
            <div className="mt-3 text-xs" style={{ color: "var(--ink-soft)" }}>
              Refresh restricted to admin / super_admin.
            </div>
          )}
          {stripeSync && (
            <div className="mt-3 space-y-2 text-sm">
              <div className="font-mono text-[10px]" style={{ color: "var(--ink-soft)" }}>
                As of {new Date(stripeSync.as_of).toLocaleString()}
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--ink)" }}>Refunds in period</span>
                <span style={{ color: "var(--ink)" }}>
                  {formatMinor(stripeSync.refunds.total_minor, stripeSync.refunds.currency ?? currency)} ({stripeSync.refunds.count})
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--ink)" }}>Invoices paid / open / uncollectible</span>
                <span style={{ color: "var(--ink)" }}>
                  {stripeSync.invoices.paid} / {stripeSync.invoices.open} / {stripeSync.invoices.uncollectible}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--ink)" }}>Recovery rate</span>
                <span style={{ color: "var(--ink)" }}>
                  {stripeSync.invoices.recovery_rate != null
                    ? `${(stripeSync.invoices.recovery_rate * 100).toFixed(1)}%`
                    : "—"}
                </span>
              </div>
            </div>
          )}
          {!stripeSync && !syncErr && (
            <div className="mt-3 text-xs" style={{ color: "var(--ink-soft)" }}>
              Pulls refund volume and invoice recovery direct from Stripe. No DB writes.
            </div>
          )}
        </div>
      </div>

      {/* Top customers */}
      <div className="mt-6 rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="border-b px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]"
          style={{ borderColor: "var(--border-soft)", color: "var(--ink-soft)" }}>
          Top customers by lifetime spend (est.)
        </div>
        {top.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm" style={{ color: "var(--ink-soft)" }}>No customers yet.</div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
            {top.map((c) => (
              <Link
                key={c.user_id}
                to="/admin/users/$id"
                params={{ id: c.user_id }}
                className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm transition-ios-colors hover:bg-[rgba(11,18,32,0.04)]"
              >
                <div className="min-w-0 flex-1 truncate" style={{ color: "var(--ink)" }}>{c.email || c.user_id.slice(0, 8)}</div>
                <div className="shrink-0 font-mono text-[10px]" style={{ color: "var(--ink-soft)" }}>
                  {c.tier} · {c.cadence} · {c.status}
                </div>
                <div className="shrink-0" style={{ color: "var(--ink)" }}>
                  {formatMinor(c.est_lifetime_minor, currency)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
