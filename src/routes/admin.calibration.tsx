import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  adminCalibrationOverview,
  adminPerLlmAccuracy,
  adminPendingResolutions,
  adminRecentResolutions,
} from "@/lib/admin/calibration";
import { ResolvePredictionModal } from "@/components/admin/ResolvePredictionModal";

export const Route = createFileRoute("/admin/calibration")({
  head: () => ({
    meta: [
      { title: "Calibration — Admin — Prophiq" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: CalibrationPage,
});

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

function fmtPct(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(1)}%`;
}
function fmtNum(n: number | null, digits = 4): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function CalibrationPage() {
  const [domainFilter, setDomainFilter] = useState<string>("");
  const [resolveTarget, setResolveTarget] = useState<{ id: string; title: string } | null>(null);

  const overviewQ = useQuery({
    queryKey: ["admin", "calibration", "overview", domainFilter],
    queryFn: () => adminCalibrationOverview(domainFilter || null),
  });
  const llmQ = useQuery({
    queryKey: ["admin", "calibration", "perLlm", domainFilter],
    queryFn: () => adminPerLlmAccuracy(domainFilter || null),
  });
  const pendingQ = useQuery({
    queryKey: ["admin", "calibration", "pending"],
    queryFn: () => adminPendingResolutions(50),
  });
  const recentQ = useQuery({
    queryKey: ["admin", "calibration", "recent"],
    queryFn: () => adminRecentResolutions(25),
  });

  const overview = overviewQ.data ?? [];
  const totals = overview.reduce(
    (a, r) => {
      const n = r.n_resolved || 0;
      a.n += n;
      a.top1 += (r.top1_accuracy ?? 0) * n;
      a.top3 += (r.top3_accuracy ?? 0) * n;
      a.brier += (r.avg_brier ?? 0) * n;
      return a;
    },
    { n: 0, top1: 0, top3: 0, brier: 0 },
  );
  const globalTop1 = totals.n > 0 ? totals.top1 / totals.n : null;
  const globalTop3 = totals.n > 0 ? totals.top3 / totals.n : null;
  const globalBrier = totals.n > 0 ? totals.brier / totals.n : null;

  const refetchAll = () => {
    overviewQ.refetch();
    llmQ.refetch();
    pendingQ.refetch();
    recentQ.refetch();
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)" }}>Calibration</h1>
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            Resolution flow + per-domain and per-LLM accuracy. Brier on a 0–1 scale (probability/100).
          </p>
        </div>
        <input
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          placeholder="Filter domain (e.g. sport)"
          className="rounded-md border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)", color: "var(--ink)", width: 220 }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Resolved (sample)"
          value={String(totals.n)}
          sub={overviewQ.isLoading ? "loading…" : `${overview.length} domains`}
        />
        <Tile label="Top-1 accuracy" value={fmtPct(globalTop1)} sub="weighted across domains" />
        <Tile label="Top-3 accuracy" value={fmtPct(globalTop3)} />
        <Tile label="Avg Brier" value={fmtNum(globalBrier, 4)} sub="lower is better" />
      </div>

      {/* Per-domain table */}
      <section className="rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>By domain</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ color: "var(--ink-soft)" }}>
              <tr className="text-left">
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Domain</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">N</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Top-1</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Top-3</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Avg top prob</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Brier</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Last</th>
              </tr>
            </thead>
            <tbody style={{ color: "var(--ink)" }}>
              {overview.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center" style={{ color: "var(--ink-soft)" }}>No resolved predictions yet.</td></tr>
              ) : overview.map((r) => (
                <tr key={r.domain} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                  <td className="px-4 py-2">{r.domain}</td>
                  <td className="px-4 py-2 font-mono">{r.n_resolved}</td>
                  <td className="px-4 py-2 font-mono">{fmtPct(r.top1_accuracy)}</td>
                  <td className="px-4 py-2 font-mono">{fmtPct(r.top3_accuracy)}</td>
                  <td className="px-4 py-2 font-mono">{fmtPct(r.avg_top_prob)}</td>
                  <td className="px-4 py-2 font-mono">{fmtNum(r.avg_brier, 4)}</td>
                  <td className="px-4 py-2" style={{ color: "var(--ink-soft)" }}>
                    {r.last_resolved_at ? new Date(r.last_resolved_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-LLM table */}
      <section className="rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>By LLM</div>
          <div className="text-xs" style={{ color: "var(--ink-soft)" }}>
            Reads <code>model_results[].ranked_outcome_ids[0]</code> as each model's top pick.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ color: "var(--ink-soft)" }}>
              <tr className="text-left">
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Model</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Sample</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">With pick</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Errors</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Top-1</th>
              </tr>
            </thead>
            <tbody style={{ color: "var(--ink)" }}>
              {(llmQ.data ?? []).length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center" style={{ color: "var(--ink-soft)" }}>No data.</td></tr>
              ) : (llmQ.data ?? []).map((r) => (
                <tr key={r.model} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                  <td className="px-4 py-2">{r.model}</td>
                  <td className="px-4 py-2 font-mono">{r.n_resolved}</td>
                  <td className="px-4 py-2 font-mono">{r.n_with_pick}</td>
                  <td className="px-4 py-2 font-mono">{r.n_errors}</td>
                  <td className="px-4 py-2 font-mono">{fmtPct(r.top1_accuracy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pending */}
      <section className="rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>Pending resolution</div>
          <div className="text-xs" style={{ color: "var(--ink-soft)" }}>Events past resolves_at with no resolution recorded.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ color: "var(--ink-soft)" }}>
              <tr className="text-left">
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Event</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Domain</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Resolves at</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Prediction</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody style={{ color: "var(--ink)" }}>
              {(pendingQ.data ?? []).length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center" style={{ color: "var(--ink-soft)" }}>Nothing pending — all caught up.</td></tr>
              ) : (pendingQ.data ?? []).map((r) => (
                <tr key={r.event_id} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                  <td className="px-4 py-2">
                    <Link to="/$domain/events/$slug" params={{ domain: r.domain, slug: r.slug }} className="underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2" style={{ color: "var(--ink-soft)" }}>{r.domain}</td>
                  <td className="px-4 py-2 font-mono" style={{ color: "var(--ink-soft)" }}>
                    {new Date(r.resolves_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2" style={{ color: r.has_current_prediction ? "var(--ink)" : "var(--ink-soft)" }}>
                    {r.has_current_prediction ? "yes" : "none"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setResolveTarget({ id: r.event_id, title: r.title })}
                      className="rounded-md px-3 py-1 text-xs font-medium"
                      style={{ background: "var(--amber-strong)", color: "var(--bg)" }}
                    >
                      Resolve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent */}
      <section className="rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>Recently resolved</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ color: "var(--ink-soft)" }}>
              <tr className="text-left">
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Event</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Winner</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Top-pick?</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">Source</th>
                <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em]">At</th>
              </tr>
            </thead>
            <tbody style={{ color: "var(--ink)" }}>
              {(recentQ.data ?? []).length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center" style={{ color: "var(--ink-soft)" }}>No resolutions yet.</td></tr>
              ) : (recentQ.data ?? []).map((r) => (
                <tr key={r.event_id} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                  <td className="px-4 py-2">
                    <Link to="/$domain/events/$slug" params={{ domain: r.domain, slug: r.slug }} className="underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.winning_label ?? "—"}</td>
                  <td className="px-4 py-2 font-mono">
                    {r.top_pick_correct === null ? "—" : r.top_pick_correct ? "✓" : "✗"}
                  </td>
                  <td className="px-4 py-2" style={{ color: "var(--ink-soft)" }}>{r.source ?? "—"}</td>
                  <td className="px-4 py-2 font-mono" style={{ color: "var(--ink-soft)" }}>
                    {new Date(r.resolved_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {resolveTarget && (
        <ResolvePredictionModal
          eventId={resolveTarget.id}
          eventTitle={resolveTarget.title}
          onClose={() => setResolveTarget(null)}
          onResolved={() => {
            setResolveTarget(null);
            refetchAll();
          }}
        />
      )}
    </div>
  );
}
