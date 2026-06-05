import { useEffect, useState } from "react";
import {
  adminEventOutcomes,
  adminResolvePrediction,
  type EventOutcomeRow,
} from "@/lib/admin/calibration";

interface Props {
  eventId: string;
  eventTitle: string;
  onClose: () => void;
  onResolved: () => void;
}

export function ResolvePredictionModal({ eventId, eventTitle, onClose, onResolved }: Props) {
  const [outcomes, setOutcomes] = useState<EventOutcomeRow[]>([]);
  const [winningId, setWinningId] = useState<string>("");
  const [context, setContext] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    adminEventOutcomes(eventId)
      .then((rows) => {
        if (!active) return;
        setOutcomes(rows);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!active) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId]);

  const submit = async () => {
    if (!winningId) {
      setError("Pick a winning outcome.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await adminResolvePrediction(eventId, winningId, context.trim() || null);
      onResolved();
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border p-5"
        style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
          Resolve event
        </div>
        <div className="mt-1 text-base font-semibold" style={{ color: "var(--ink)" }}>{eventTitle}</div>

        {loading ? (
          <div className="mt-4 text-sm" style={{ color: "var(--ink-soft)" }}>Loading outcomes…</div>
        ) : outcomes.length === 0 ? (
          <div className="mt-4 text-sm" style={{ color: "var(--ink-soft)" }}>No outcomes registered for this event.</div>
        ) : (
          <div className="mt-4 flex max-h-72 flex-col gap-1.5 overflow-auto">
            {outcomes.map((o) => (
              <label
                key={o.outcome_id}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
                style={{
                  borderColor: winningId === o.outcome_id ? "var(--amber-strong)" : "var(--border-soft)",
                  background: winningId === o.outcome_id ? "rgba(245,158,11,0.06)" : "transparent",
                  color: "var(--ink)",
                }}
              >
                <input
                  type="radio"
                  name="winner"
                  value={o.outcome_id}
                  checked={winningId === o.outcome_id}
                  onChange={() => setWinningId(o.outcome_id)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        )}

        <label className="mt-4 block font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--ink-soft)" }}>
          Context (optional)
        </label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={2}
          placeholder="Source URL, note, etc."
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)", color: "var(--ink)" }}
        />

        {error && (
          <div className="mt-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--danger, #b91c1c)", color: "var(--danger, #b91c1c)" }}>
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--border-soft)", color: "var(--ink)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !winningId}
            className="rounded-md px-3 py-1.5 text-sm font-medium"
            style={{ background: "var(--amber-strong)", color: "var(--bg)" }}
          >
            {submitting ? "Resolving…" : "Resolve"}
          </button>
        </div>
      </div>
    </div>
  );
}
