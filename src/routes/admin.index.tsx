import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { adminDashboardSummary } from "@/lib/admin/health";
import { adminHealthFailures } from "@/lib/admin/health";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Admin dashboard — Prophiq" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: DashboardPage,
});

function formatMoney(minor: number, currency: string | null): string {
  const major = minor / 100;
  const cur = currency ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(major);
  } catch {
    return `${cur} ${major.toFixed(0)}`;
  }
}

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
      <div className="font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>{label}</div>
      <div className="mt-2 text-2xl font-semibold" style={{ color: "var(--ink)" }}>{value}</div>
      {sub && <div className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>{sub}</div>}
    </div>
  );
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function DashboardPage() {
  const { data: summary } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => adminDashboardSummary(),
    refetchInterval: 60_000,
  });
  const { data: failures = [] } = useQuery({
    queryKey: ["admin", "dashboard", "failures"],
    queryFn: () => adminHealthFailures(10),
    refetchInterval: 60_000,
  });

  const banner =
    summary && (summary.unresolved_critical > 0 || (summary.health?.down ?? 0) > 0)
      ? `${summary.unresolved_critical} unresolved critical · ${summary.health.down} service(s) down`
      : null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
        Admin
      </div>
      <h1 className="text-2xl font-semibold" style={{ color: "var(--ink)" }}>Dashboard</h1>

      {banner && (
        <Link
          to="/admin/health"
          className="mt-4 block rounded-xl border px-4 py-3 text-sm transition-ios-colors hover:opacity-90"
          style={{ borderColor: "#B91C1C44", background: "#B91C1C0d", color: "#B91C1C" }}
        >
          ⚠ {banner} — open System health →
        </Link>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile
          label="Signups today"
          value={summary?.signups_today ?? "…"}
          sub={summary ? `${summary.signups_7d} in last 7d` : undefined}
        />
        <Tile
          label="Active subs"
          value={summary?.active_subscriptions ?? "…"}
          sub={summary ? `${summary.trialing} trialing` : undefined}
        />
        <Tile label="Questions today" value={summary?.questions_today ?? "…"} />
        <Tile
          label="Est. MRR"
          value={summary ? formatMoney(summary.mrr_minor_units, summary.mrr_currency) : "…"}
          sub="Catalog estimate, not booked revenue"
        />
        <Tile
          label="Critical alerts"
          value={summary?.unresolved_critical ?? "…"}
          sub="Unresolved"
        />
      </div>

      {summary?.health && (
        <Link
          to="/admin/health"
          className="mt-6 block rounded-xl border p-4 transition-ios-colors hover:bg-[rgba(11,18,32,0.04)]"
          style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
            System health (last 24h)
          </div>
          <div className="mt-2 flex items-center gap-4 text-sm">
            <span className="flex items-center gap-2" style={{ color: "var(--ink)" }}>
              <span className="h-2 w-2 rounded-full" style={{ background: "#15803D" }} />
              {summary.health.ok} ok
            </span>
            <span className="flex items-center gap-2" style={{ color: "var(--ink)" }}>
              <span className="h-2 w-2 rounded-full" style={{ background: "var(--amber-strong)" }} />
              {summary.health.degraded} degraded
            </span>
            <span className="flex items-center gap-2" style={{ color: "var(--ink)" }}>
              <span className="h-2 w-2 rounded-full" style={{ background: "#B91C1C" }} />
              {summary.health.down} down
            </span>
          </div>
        </Link>
      )}

      <div className="mt-6 rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="border-b px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]"
          style={{ borderColor: "var(--border-soft)", color: "var(--ink-soft)" }}>
          Recent failures
        </div>
        {failures.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm" style={{ color: "var(--ink-soft)" }}>
            No recent failures.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
            {failures.map((f, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm">
                <span style={{ color: "var(--ink)" }}>{f.label}</span>
                <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px]" style={{ color: "var(--ink-soft)" }} title={f.detail ?? ""}>
                  {f.detail ?? "—"}
                </span>
                <span className="font-mono text-[10px]" style={{ color: "var(--ink-soft)" }}>{relTime(f.checked_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
