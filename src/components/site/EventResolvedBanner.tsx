interface Props {
  correct: boolean;
  actualOutcome: string | null;
  topPickAtTime: string | null;
  topPickPct: number | null;
}

export function EventResolvedBanner({
  correct,
  actualOutcome,
  topPickAtTime,
  topPickPct,
}: Props) {
  const bg = correct ? "var(--green)" : "var(--amber-strong)";
  const headline = correct ? "We called it." : "Off this one.";
  const pct = topPickPct != null ? `${Math.round(topPickPct)}%` : "—";
  return (
    <div
      className="rounded-2xl px-5 py-5 text-white"
      style={{ background: bg }}
      role="status"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 font-display text-[22px]"
          style={{ fontWeight: 700 }}
        >
          {correct ? "✓" : "✗"}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="font-display text-[22px] leading-tight tracking-[-0.02em]"
            style={{ fontWeight: 700 }}
          >
            {headline}
          </div>
          <p
            className="mt-1 font-body text-[13px] leading-snug text-white/90"
          >
            Prophiq's top pick:{" "}
            <span className="font-medium text-white">
              {topPickAtTime ?? "—"} ({pct})
            </span>{" "}
            · Actual winner:{" "}
            <span className="font-medium text-white">
              {actualOutcome ?? "—"}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
