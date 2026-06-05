import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  adminHealthOverview,
  adminHealthFailures,
  adminForecastVolume,
  triggerHealthRetry,
  type HealthOverviewRow,
  type HealthStatus,
} from "@/lib/admin/health";
import type { AdminRole } from "@/lib/admin/queries";
import { Route as AdminRoute } from "./admin";

export const Route = createFileRoute("/admin/health")({
  head: () => ({ meta: [{ title: "System health — Admin — Prophiq" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: HealthPage,
});

function statusColor(s: HealthStatus): string {
  if (s === "ok") return "#15803D";
  if (s === "degraded") return "var(--amber-strong)";
  if (s === "down") return "#B91C1C";
  return "var(--ink-soft)";
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

function CategoryLabel({ cat }: { cat: HealthOverviewRow["category"] }) {
  const labels: Record<HealthOverviewRow["category"], string> = {
    llm: "LLM",
    research: "Research",
    structured_data: "Structured data",
    infra: "Infrastructure",
    payments: "Payments",
  };
  return (
    <div className="mb-2 mt-6 font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
      {labels[cat]}
    </div>
  );
}

function HealthCard({ row, canRetry, onRetry, retrying }: {
  row: HealthOverviewRow;
  canRetry: boolean;
  onRetry: (key: string) => void;
  retrying: boolean;
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor(row.current_status) }} />
            <span className="truncate text-sm font-semibold" style={{ color: "var(--ink)" }}>{row.label}</span>
            {row.critical && (
              <span className="rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]"
                style={{ background: "#B91C1C14", color: "#B91C1C" }}>
                Critical
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[10px]" style={{ color: "var(--ink-soft)" }}>
            {row.current_status} · {relTime(row.last_checked_at)}
          </div>
        </div>
        {canRetry && (
          <button
            type="button"
            onClick={() => onRetry(row.key)}
            disabled={retrying}
            className="rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-ios-colors hover:bg-[rgba(11,18,32,0.05)] disabled:opacity-50"
            style={{ borderColor: "var(--border-strong)", color: "var(--ink)" }}
          >
            {retrying ? "…" : "Retry"}
          </button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs" style={{ color: "var(--ink-soft)" }}>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider">P50</div>
          <div className="text-sm" style={{ color: "var(--ink)" }}>{row.p50_latency_ms != null ? `${row.p50_latency_ms}ms` : "—"}</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider">P95</div>
          <div className="text-sm" style={{ color: "var(--ink)" }}>{row.p95_latency_ms != null ? `${row.p95_latency_ms}ms` : "—"}</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider">Uptime</div>
          <div className="text-sm" style={{ color: "var(--ink)" }}>{(Number(row.success_rate) * 100).toFixed(1)}%</div>
        </div>
      </div>
      {row.last_detail && (
        <div className="mt-2 truncate font-mono text-[10px]" style={{ color: "var(--ink-soft)" }} title={row.last_detail}>
          {row.last_detail}
        </div>
      )}
    </div>
  );
}

function HealthPage() {
  const ctx = AdminRoute.useRouteContext();
  const adminRole = (ctx as { adminRole?: AdminRole | null }).adminRole ?? null;
  const canRetry = adminRole === "super_admin" || adminRole === "admin";
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState<string | null>(null);

  const { data: overview = [] } = useQuery({
    queryKey: ["admin", "health", "overview"],
    queryFn: () => adminHealthOverview(168),
    refetchInterval: 30_000,
  });
  const { data: failures = [] } = useQuery({
    queryKey: ["admin", "health", "failures"],
    queryFn: () => adminHealthFailures(25),
    refetchInterval: 30_000,
  });
  const { data: volume = [] } = useQuery({
    queryKey: ["admin", "health", "volume"],
    queryFn: () => adminForecastVolume(7),
    refetchInterval: 60_000,
  });

  async function handleRetry(key: string) {
    setRetrying(key);
    try {
      await triggerHealthRetry(key);
      await queryClient.invalidateQueries({ queryKey: ["admin", "health"] });
    } finally {
      setRetrying(null);
    }
  }

  // Group by category, preserving the RPC's critical-first ordering.
  const groups: HealthOverviewRow["category"][] = ["llm", "research", "payments", "infra", "structured_data"];
  const byCat = new Map<string, HealthOverviewRow[]>();
  for (const r of overview) {
    const list = byCat.get(r.category) ?? [];
    list.push(r);
    byCat.set(r.category, list);
  }

  const maxVol = Math.max(1, ...volume.map((v) => v.prediction_count));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
        Admin
      </div>
      <h1 className="text-2xl font-semibold" style={{ color: "var(--ink)" }}>System health</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--ink-soft)" }}>
        Auto-probed every 5 minutes. Latency & uptime over the last 7 days.
      </p>

      {groups.filter((g) => byCat.get(g)?.length).map((cat) => (
        <div key={cat}>
          <CategoryLabel cat={cat} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {byCat.get(cat)!.map((row) => (
              <HealthCard
                key={row.key}
                row={row}
                canRetry={canRetry}
                onRetry={handleRetry}
                retrying={retrying === row.key}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Forecast volume */}
      <div className="mt-10 rounded-xl border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
          Forecast volume (last 7 days)
        </div>
        <div className="text-xs" style={{ color: "var(--ink-soft)" }}>
          Catalog-based proxy. Full cost attribution lands in Phase 7.D.
        </div>
        <div className="mt-4 flex h-24 items-end gap-2">
          {volume.map((v) => (
            <div key={v.day} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t"
                style={{
                  height: `${(v.prediction_count / maxVol) * 100}%`,
                  minHeight: 2,
                  background: "var(--amber-strong)",
                }}
                title={`${v.prediction_count} predictions · ${v.perplexity_tokens} ppx tokens`}
              />
              <div className="font-mono text-[10px]" style={{ color: "var(--ink-soft)" }}>
                {new Date(v.day).toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <div className="font-mono text-[10px]" style={{ color: "var(--ink)" }}>{v.prediction_count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Failure log */}
      <div className="mt-6 rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="border-b px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]"
          style={{ borderColor: "var(--border-soft)", color: "var(--ink-soft)" }}>
          Recent failures
        </div>
        {failures.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm" style={{ color: "var(--ink-soft)" }}>
            No failures in the recent window.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
            {failures.map((f, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: statusColor(f.status) }} />
                  <span style={{ color: "var(--ink)" }}>{f.label}</span>
                  <span className="font-mono text-[10px]" style={{ color: "var(--ink-soft)" }}>{f.status}</span>
                </div>
                <div className="min-w-0 flex-1 truncate text-right font-mono text-[11px]" style={{ color: "var(--ink-soft)" }} title={f.detail ?? ""}>
                  {f.detail ?? "—"}
                </div>
                <div className="shrink-0 font-mono text-[10px]" style={{ color: "var(--ink-soft)" }}>
                  {relTime(f.checked_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
