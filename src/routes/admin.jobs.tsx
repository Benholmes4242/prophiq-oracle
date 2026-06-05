import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  adminCronOverview,
  adminCronRuns,
  adminRunCronJob,
  adminSetCronActive,
  humanizeCron,
  type CronOverviewRow,
} from "@/lib/admin/jobs";

export const Route = createFileRoute("/admin/jobs")({
  component: JobsPage,
});

function fmtRel(d: string | null) {
  if (!d) return "never";
  const ago = Date.now() - new Date(d).getTime();
  const m = Math.round(ago / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function statusColor(s: string | null): string {
  if (s === "succeeded") return "#059669";
  if (s === "failed") return "#dc2626";
  if (s === "partial") return "#d97706";
  if (s === "skipped") return "#64748b";
  return "#94a3b8";
}

function JobsPage() {
  const qc = useQueryClient();
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const { data: overview, isLoading } = useQuery({
    queryKey: ["admin-cron-overview"],
    queryFn: adminCronOverview,
    refetchInterval: 30_000,
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin-cron-overview"] });
    if (openJob) await qc.invalidateQueries({ queryKey: ["admin-cron-runs", openJob] });
  };

  const trigger = async (name: string) => {
    setBusy(name);
    setError(null);
    setInfo(null);
    try {
      await adminRunCronJob(name);
      setInfo(`Triggered ${name}`);
      await refresh();
    } catch (e) {
      setError(`${name}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const togglePause = async (row: CronOverviewRow) => {
    setBusy(row.job_name);
    setError(null);
    try {
      await adminSetCronActive(row.job_name, row.paused);
      await refresh();
    } catch (e) {
      setError(`${row.job_name}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--ink-faint)", fontWeight: 600 }}>ADMIN</p>
        <h1 className="font-display tracking-[-0.03em]" style={{ fontWeight: 700, fontSize: 28, lineHeight: 1 }}>
          Jobs<span style={{ color: "var(--amber)" }}>.</span>
        </h1>
        <p className="mt-2 font-body text-[13px]" style={{ color: "var(--ink-soft)" }}>
          Scheduled background work. Edge jobs self-report on completion; SQL refresh jobs are timed in their wrappers.
        </p>
      </div>

      {error && <div className="mb-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "#dc2626", color: "#dc2626" }}>{error}</div>}
      {info && <div className="mb-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--border-soft)", color: "var(--ink-soft)" }}>{info}</div>}

      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <table className="w-full border-collapse text-left font-body text-[13px]">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-faint)" }}>
              <th className="px-3 py-2 font-semibold">Job</th>
              <th className="px-3 py-2 font-semibold">Schedule</th>
              <th className="px-3 py-2 font-semibold">Last run</th>
              <th className="px-3 py-2 text-right font-semibold">Avg ms</th>
              <th className="px-3 py-2 text-right font-semibold">Success 30d</th>
              <th className="px-3 py-2 text-right font-semibold">Runs 30d</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center" style={{ color: "var(--ink-soft)" }}>Loading…</td></tr>
            )}
            {(overview ?? []).map((row) => (
              <>
                <tr key={row.job_name} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setOpenJob(openJob === row.job_name ? null : row.job_name)} className="text-left hover:underline" style={{ color: "var(--ink)" }}>
                      {row.job_name}
                    </button>
                    {row.paused && (
                      <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[9px] uppercase" style={{ background: "#64748b14", color: "#64748b", border: "1px solid #64748b33" }}>
                        paused
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }} title={row.schedule}>
                    {humanizeCron(row.schedule)}
                  </td>
                  <td className="px-3 py-2" style={{ color: statusColor(row.last_status) }}>
                    {row.last_status ?? "—"} · <span style={{ color: "var(--ink-soft)" }}>{fmtRel(row.last_ran_at)}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{row.avg_duration_ms_30d ? Math.round(row.avg_duration_ms_30d) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.success_rate_30d != null ? `${Math.round(row.success_rate_30d * 100)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{row.run_count_30d}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button type="button" disabled={busy === row.job_name} onClick={() => trigger(row.job_name)} className="rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: "var(--border-strong)" }}>
                        Run
                      </button>
                      <button type="button" disabled={busy === row.job_name} onClick={() => togglePause(row)} className="rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: row.paused ? "#059669" : "#d97706", color: row.paused ? "#059669" : "#d97706" }}>
                        {row.paused ? "Resume" : "Pause"}
                      </button>
                    </div>
                  </td>
                </tr>
                {openJob === row.job_name && (
                  <tr key={`${row.job_name}-detail`} style={{ background: "rgba(11,18,32,0.02)" }}>
                    <td colSpan={7} className="px-3 py-3">
                      <RunHistory jobName={row.job_name} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunHistory({ jobName }: { jobName: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-cron-runs", jobName],
    queryFn: () => adminCronRuns(jobName, 50),
  });

  if (isLoading) return <div className="text-xs" style={{ color: "var(--ink-soft)" }}>Loading runs…</div>;
  if (error) return <div className="text-xs" style={{ color: "#dc2626" }}>{(error as Error).message}</div>;
  const rows = data ?? [];
  if (rows.length === 0) return <div className="text-xs" style={{ color: "var(--ink-soft)" }}>No runs recorded yet.</div>;

  const maxDur = Math.max(1, ...rows.map((r) => r.duration_ms ?? 0));

  return (
    <div>
      <div className="mb-2 flex items-end gap-0.5" style={{ height: 28 }}>
        {[...rows].reverse().map((r) => (
          <div
            key={r.id}
            title={`${r.status} · ${r.duration_ms ?? "?"}ms · ${new Date(r.ran_at).toUTCString()}`}
            style={{
              width: 4,
              height: Math.max(2, ((r.duration_ms ?? 0) / maxDur) * 28),
              background: statusColor(r.status),
              opacity: 0.7,
            }}
          />
        ))}
      </div>
      <table className="w-full border-collapse text-left text-[12px]">
        <thead>
          <tr className="font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-faint)" }}>
            <th className="px-2 py-1">Ran at</th>
            <th className="px-2 py-1">Status</th>
            <th className="px-2 py-1 text-right">ms</th>
            <th className="px-2 py-1 text-right">Items</th>
            <th className="px-2 py-1">Detail</th>
            <th className="px-2 py-1">Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 20).map((r) => (
            <tr key={r.id} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
              <td className="px-2 py-1 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>{new Date(r.ran_at).toUTCString()}</td>
              <td className="px-2 py-1" style={{ color: statusColor(r.status) }}>{r.status}</td>
              <td className="px-2 py-1 text-right font-mono">{r.duration_ms ?? "—"}</td>
              <td className="px-2 py-1 text-right font-mono">{r.items_processed ?? "—"}</td>
              <td className="px-2 py-1 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
                {Object.keys(r.detail ?? {}).length === 0 ? "—" : JSON.stringify(r.detail)}
              </td>
              <td className="px-2 py-1 text-[11px]" style={{ color: "#dc2626" }}>{r.error_message ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
