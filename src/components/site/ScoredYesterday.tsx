import type { ScoredPick } from "@/lib/queries";

export function ScoredYesterday({ picks }: { picks: ScoredPick[] }) {
  if (picks.length === 0) {
    return (
      <p
        className="rounded-xl px-4 py-6 text-center font-body text-[13px]"
        style={{
          background: "var(--bg-card)",
          border: "1px dashed var(--border-soft)",
          color: "var(--ink-soft)",
        }}
      >
        No events scored yet in the last 24 hours.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      {picks.map((r, i) => (
        <div
          key={r.event_id}
          className="flex items-center gap-3 py-2.5"
          style={{
            borderBottom:
              i < picks.length - 1 ? "1px solid var(--border-soft)" : "none",
          }}
        >
          <span
            className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white"
            style={{
              background: r.correct ? "var(--green)" : "var(--amber-strong)",
            }}
            aria-label={r.correct ? "Correct" : "Incorrect"}
          >
            {r.correct ? "✓" : "✗"}
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="truncate font-body text-[13px] leading-tight"
              style={{ color: "var(--ink-soft)" }}
            >
              {r.event_title}
            </div>
          </div>
          <span
            className="shrink-0 font-mono text-[11px]"
            style={{ color: "var(--ink)", fontWeight: 600 }}
          >
            {r.pick_label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ScoredYesterdayHeader({
  picks,
}: {
  picks: ScoredPick[];
}) {
  const correct = picks.filter((p) => p.correct).length;
  return (
    <div className="flex items-center gap-3">
      <span
        className="font-mono text-[10px] tracking-[0.2em]"
        style={{ color: "var(--ink-faint)", fontWeight: 600 }}
      >
        SCORED YESTERDAY
      </span>
      <span
        className="h-px flex-1"
        style={{ background: "var(--border-soft)" }}
      />
      {picks.length > 0 && (
        <span
          className="font-mono text-[10px]"
          style={{ color: "var(--green)", fontWeight: 600 }}
        >
          {correct}/{picks.length}
        </span>
      )}
    </div>
  );
}
