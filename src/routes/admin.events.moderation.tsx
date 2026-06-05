import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { adminListEvents, type AdminEventRow } from "@/lib/admin/events";
import { adminApproveQuestion, adminRejectQuestion } from "@/lib/admin/actions";

export const Route = createFileRoute("/admin/events/moderation")({
  component: ModerationQueuePage,
});

const REJECT_TEMPLATES = [
  "Not a verifiable future event",
  "Duplicate of an existing event",
  "Outcome is not objectively measurable",
  "Resolves too far in the future",
  "Insufficient information to model",
];

function ModerationQueuePage() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>(REJECT_TEMPLATES[0]);
  const [rejectFree, setRejectFree] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: qErr } = useQuery({
    queryKey: ["admin-events-moderation"],
    queryFn: () =>
      adminListEvents({ moderation_status: "pending", limit: 100, offset: 0 }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-events-moderation"] });

  const approve = async (row: AdminEventRow) => {
    setBusyId(row.id);
    setError(null);
    try {
      await adminApproveQuestion(row.id);
      await refresh();
    } catch (e) {
      setError(`${row.title}: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const submitReject = async () => {
    if (!rejectId) return;
    const reason = (rejectFree.trim() || rejectReason).trim();
    if (!reason) return;
    setBusyId(rejectId);
    setError(null);
    try {
      await adminRejectQuestion(rejectId, reason);
      setRejectId(null);
      setRejectFree("");
      setRejectReason(REJECT_TEMPLATES[0]);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const rows = data?.rows ?? [];

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--ink-faint)", fontWeight: 600 }}>ADMIN</p>
          <h1 className="font-display tracking-[-0.03em]" style={{ fontWeight: 700, fontSize: 28, lineHeight: 1 }}>
            Moderation queue<span style={{ color: "var(--amber)" }}>.</span>
          </h1>
        </div>
        <Link to="/admin/events" className="font-mono text-[11px] underline" style={{ color: "var(--ink-soft)" }}>
          All events →
        </Link>
      </div>

      <p className="mb-4 font-body text-[13px]" style={{ color: "var(--ink-soft)" }}>
        {isLoading ? "Loading…" : `${rows.length} pending submission${rows.length === 1 ? "" : "s"}`}
      </p>

      {qErr && <div className="mb-3 text-xs" style={{ color: "#dc2626" }}>{(qErr as Error).message}</div>}
      {error && <div className="mb-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "#dc2626", color: "#dc2626" }}>{error}</div>}

      <div className="rounded-lg border" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        {rows.length === 0 && !isLoading && (
          <div className="px-3 py-10 text-center text-sm" style={{ color: "var(--ink-soft)" }}>
            Nothing pending. Nice.
          </div>
        )}
        {rows.map((r) => (
          <div key={r.id} className="border-b p-3 last:border-b-0" style={{ borderColor: "var(--border-soft)" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link to="/admin/events/$id" params={{ id: r.id }} className="block text-[14px] font-medium hover:underline" style={{ color: "var(--ink)" }}>
                  {r.title}
                </Link>
                <div className="mt-1 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
                  {r.domain} · {r.source} · submitted {r.submitted_at ? new Date(r.submitted_at).toUTCString() : "?"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => approve(r)}
                  className="rounded-md px-3 py-1.5 text-[12px] font-medium"
                  style={{ background: "var(--amber-strong)", color: "var(--bg)" }}
                >
                  {busyId === r.id ? "…" : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => { setRejectId(r.id); setRejectFree(""); setRejectReason(REJECT_TEMPLATES[0]); }}
                  className="rounded-md border px-3 py-1.5 text-[12px]"
                  style={{ borderColor: "#dc2626", color: "#dc2626" }}
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {rejectId && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setRejectId(null)}>
          <div className="w-full max-w-md rounded-xl border p-5" style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }} onClick={(e) => e.stopPropagation()}>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>Reject submission</div>
            <label className="mt-3 block font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Template reason</label>
            <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
              {REJECT_TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="mt-3 block font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Or custom reason (overrides template)</label>
            <textarea value={rejectFree} onChange={(e) => setRejectFree(e.target.value)} rows={3} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }} />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRejectId(null)} className="rounded-md border px-3 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)" }}>Back</button>
              <button type="button" disabled={busyId === rejectId} onClick={submitReject} className="rounded-md px-3 py-1.5 text-sm font-medium" style={{ background: "#dc2626", color: "white" }}>
                {busyId === rejectId ? "Rejecting…" : "Confirm reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
