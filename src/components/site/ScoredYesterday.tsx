import type { ScoredPick } from "@/lib/queries";

export function ScoredYesterday({ picks }: { picks: ScoredPick[] }) {
  if (picks.length === 0) {
    return (
      <p
        className="rounded-xl px-4 py-6 text-center"
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          background: "var(--bg-card)",
          border: "1px dashed var(--line)",
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
              i < picks.length - 1 ? "1px solid var(--line)" : "none",
          }}
        >
          <Indicator correct={r.correct} />
          <div
            className="min-w-0 flex-1 truncate"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              lineHeight: 1.3,
              color: "var(--ink-soft)",
            }}
          >
            {r.event_title}
          </div>
          <span
            className="shrink-0 font-mono"
            style={{
              fontSize: 11,
              color: "var(--ink)",
              fontWeight: 600,
            }}
          >
            {r.pick_label}
          </span>
        </div>
      ))}
    </div>
  );
}

function Indicator({ correct }: { correct: boolean }) {
  if (correct) {
    return (
      <span
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
        style={{ background: "color-mix(in oklab, var(--green) 12%, transparent)" }}
        aria-label="Correct"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6.5L5 9L9.5 3.5"
            stroke="var(--green)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
      style={{ border: "1px solid var(--line)" }}
      aria-label="Incorrect"
    >
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
        <path
          d="M2 2L8 8M8 2L2 8"
          stroke="var(--ink-faint)"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function ScoredYesterdayHeader({ picks }: { picks: ScoredPick[] }) {
  const correct = picks.filter((p) => p.correct).length;
  return (
    <div className="flex items-center gap-3">
      <span
        className="font-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          fontWeight: 600,
        }}
      >
        Scored yesterday
      </span>
      <span className="h-px flex-1" style={{ background: "var(--line)" }} />
      {picks.length > 0 && (
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            color: "var(--ink-faint)",
            fontWeight: 600,
          }}
        >
          {correct}/{picks.length} settled
        </span>
      )}
    </div>
  );
}
