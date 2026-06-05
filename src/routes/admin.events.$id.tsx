import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  adminGetEventDetail,
  adminEditEvent,
  adminCancelEvent,
  adminPinEvent,
  adminUnpinEvent,
  type AdminEventDetail,
} from "@/lib/admin/events";
import { triggerOnDemandPrediction, type PredictionMode } from "@/lib/triggers";
import { ResolvePredictionModal } from "@/components/admin/ResolvePredictionModal";

export const Route = createFileRoute("/admin/events/$id")({
  component: EventDetailPage,
});

function pill(color: string, bg: string, label: string) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
      style={{ background: bg, color, border: `1px solid ${color}33` }}
    >
      {label}
    </span>
  );
}

function EventDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-event-detail", id],
    queryFn: () => adminGetEventDetail(id),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-event-detail", id] });

  const wrap = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr(null);
    setInfo(null);
    try {
      await fn();
      await refresh();
      setInfo(`${label}: done`);
    } catch (e) {
      setErr(`${label}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) return <div className="px-2 py-4 text-sm" style={{ color: "var(--ink-soft)" }}>Loading event…</div>;
  if (error) return <div className="px-2 py-4 text-sm" style={{ color: "var(--amber)" }}>{(error as Error).message}</div>;
  if (!data) return null;

  const e = data.event;
  const pred = data.current_prediction;

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate({ to: "/admin/events" })}
          className="font-mono text-[11px] underline"
          style={{ color: "var(--ink-soft)" }}
        >
          ← Events
        </button>
        <div className="flex items-center gap-1.5">
          {pill("#64748b", "#64748b14", e.domain)}
          {e.status === "cancelled" && pill("#dc2626", "#dc262614", "cancelled")}
          {e.status === "resolved" && pill("#64748b", "#64748b14", "resolved")}
          {e.moderation_status === "pending" && pill("#d97706", "#d9770614", "pending moderation")}
        </div>
      </div>

      <h1 className="font-display tracking-[-0.02em]" style={{ fontWeight: 700, fontSize: 22 }}>
        {e.title}
      </h1>
      <p className="mt-1 font-body text-[13px]" style={{ color: "var(--ink-soft)" }}>{e.question}</p>

      <div className="mt-4 grid grid-cols-2 gap-3 font-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
        <div>Starts: {new Date(e.starts_at).toUTCString()}</div>
        <div>Resolves: {new Date(e.resolves_at).toUTCString()}</div>
        <div>Source: {e.source}</div>
        <div>Mode: {e.mode}</div>
        <div>Slug: {e.slug}</div>
        <div>ID: {e.id}</div>
      </div>

      {/* Actions */}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" disabled={!!busy} onClick={() => setEditing((v) => !v)}
          className="rounded-md border px-3 py-1.5 text-[12px]"
          style={{ borderColor: "var(--border-strong)" }}>
          {editing ? "Cancel edit" : "Edit"}
        </button>
        <button type="button" disabled={!!busy}
          onClick={() => wrap("Regenerate prediction", () => triggerOnDemandPrediction(id, e.mode === "odds" ? "odds" : "prediction" as PredictionMode))}
          className="rounded-md border px-3 py-1.5 text-[12px]"
          style={{ borderColor: "var(--border-strong)" }}>
          Force regenerate
        </button>
        <PinControls eventId={id} onAction={wrap} busy={!!busy} />
        <button type="button" disabled={!!busy || e.status === "resolved" || e.status === "cancelled"}
          onClick={() => setShowResolve(true)}
          className="rounded-md border px-3 py-1.5 text-[12px]"
          style={{ borderColor: "var(--border-strong)" }}>
          Resolve…
        </button>
        <CancelButton eventId={id} disabled={!!busy || e.status === "cancelled"} onDone={refresh} />
      </div>

      {err && <div className="mt-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "#dc2626", color: "#dc2626" }}>{err}</div>}
      {info && <div className="mt-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--border-soft)", color: "var(--ink-soft)" }}>{info}</div>}

      {editing && <EditForm detail={data} onSaved={() => { setEditing(false); refresh(); }} />}

      <section className="mt-6">
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Outcomes</h2>
        <ul className="rounded-lg border" style={{ borderColor: "var(--border-soft)" }}>
          {data.outcomes.map((o) => (
            <li key={o.id} className="border-b px-3 py-2 text-[13px] last:border-b-0" style={{ borderColor: "var(--border-soft)" }}>
              {o.label}
            </li>
          ))}
        </ul>
      </section>

      {pred && (
        <section className="mt-6">
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>
            Current prediction · {pred.consensus_method ?? "?"} · agreement {pred.agreement_score?.toFixed?.(2) ?? "?"}
          </h2>
          <div className="rounded-lg border p-3" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
            <ol className="space-y-1.5 text-[13px]">
              {pred.ranked_outcomes.map((r, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span>{(r.outcome_label as string) ?? (r.outcome_id as string)}</span>
                  <span className="font-mono">{Math.round((r.probability as number) ?? 0)}%</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {data.children.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>
            Sub-questions ({data.children.length})
          </h2>
          <ul className="rounded-lg border" style={{ borderColor: "var(--border-soft)" }}>
            {data.children.map((c) => (
              <li key={c.id} className="border-b px-3 py-2 text-[13px] last:border-b-0" style={{ borderColor: "var(--border-soft)" }}>
                <Link to="/admin/events/$id" params={{ id: c.id }} className="hover:underline">
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.resolution && (
        <section className="mt-6">
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Resolution</h2>
          <div className="rounded-lg border p-3 text-[13px]" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
            <div>Resolved: {new Date(data.resolution.resolved_at).toUTCString()}</div>
            <div style={{ color: "var(--ink-soft)" }}>Source: {data.resolution.source ?? "—"}</div>
            {data.resolution.resolution_context && (
              <div className="mt-1" style={{ color: "var(--ink-soft)" }}>{data.resolution.resolution_context}</div>
            )}
          </div>
        </section>
      )}

      {showResolve && (
        <ResolvePredictionModal
          eventId={id}
          eventTitle={e.title}
          onClose={() => setShowResolve(false)}
          onResolved={() => { setShowResolve(false); refresh(); }}
        />
      )}
    </div>
  );
}

function PinControls({ eventId, onAction, busy }: { eventId: string; onAction: (label: string, fn: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-md border" style={{ borderColor: "var(--border-strong)" }}>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="px-2 py-1.5 text-[12px]"
        style={{ background: "var(--bg)" }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => onAction("Pin to homepage", () => adminPinEvent(eventId, date))}
        className="border-l px-3 py-1.5 text-[12px]"
        style={{ borderColor: "var(--border-strong)" }}
      >
        Pin
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onAction("Unpin", () => adminUnpinEvent(eventId, date))}
        className="border-l px-3 py-1.5 text-[12px]"
        style={{ borderColor: "var(--border-strong)" }}
      >
        Unpin
      </button>
    </div>
  );
}

function CancelButton({ eventId, disabled, onDone }: { eventId: string; disabled: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await adminCancelEvent(eventId, reason.trim());
      setOpen(false);
      setReason("");
      setConfirm("");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="rounded-md border px-3 py-1.5 text-[12px]"
        style={{ borderColor: "#dc2626", color: "#dc2626" }}
      >
        Cancel event
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-xl border p-5" style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }} onClick={(e) => e.stopPropagation()}>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>Cancel event</div>
            <p className="mt-2 text-sm">This sets the event status to cancelled. It does not delete the event or its predictions.</p>
            <label className="mt-3 block font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>Reason</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }} />
            <label className="mt-3 block font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>Type CANCEL to confirm</label>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }} />
            {error && <div className="mt-2 text-xs" style={{ color: "#dc2626" }}>{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md border px-3 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)" }}>Back</button>
              <button type="button" disabled={submitting || confirm !== "CANCEL" || reason.trim().length === 0} onClick={go}
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ background: "#dc2626", color: "white", opacity: confirm === "CANCEL" && reason.trim() ? 1 : 0.4 }}>
                {submitting ? "Cancelling…" : "Cancel event"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function EditForm({ detail, onSaved }: { detail: AdminEventDetail; onSaved: () => void }) {
  const e = detail.event;
  const [title, setTitle] = useState(e.title);
  const [question, setQuestion] = useState(e.question);
  const [description, setDescription] = useState(e.description ?? "");
  const [startsAt, setStartsAt] = useState(e.starts_at.slice(0, 16));
  const [resolvesAt, setResolvesAt] = useState(e.resolves_at.slice(0, 16));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {};
      if (title !== e.title) patch.title = title;
      if (question !== e.question) patch.question = question;
      if (description !== (e.description ?? "")) patch.description = description;
      const startIso = new Date(startsAt).toISOString();
      if (startIso !== e.starts_at) patch.starts_at = startIso;
      const resIso = new Date(resolvesAt).toISOString();
      if (resIso !== e.resolves_at) patch.resolves_at = resIso;
      if (Object.keys(patch).length === 0) {
        setError("No changes to save.");
        return;
      }
      await adminEditEvent(e.id, patch);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Edit event (whitelisted fields)</div>
      <div className="mt-3 grid grid-cols-1 gap-3">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }} />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Question</span>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }} />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Starts at (UTC)</span>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }} />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-soft)" }}>Resolves at (UTC)</span>
            <input type="datetime-local" value={resolvesAt} onChange={(e) => setResolvesAt(e.target.value)} className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }} />
          </label>
        </div>
      </div>
      {error && <div className="mt-3 text-xs" style={{ color: "#dc2626" }}>{error}</div>}
      <div className="mt-4 flex justify-end">
        <button type="button" disabled={submitting} onClick={submit} className="rounded-md px-3 py-1.5 text-sm font-medium" style={{ background: "var(--amber-strong)", color: "var(--bg)" }}>
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
