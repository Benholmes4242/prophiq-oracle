// ReasoningCard — the "WHY {PICK}" amber-tinted card for the #1 pick.
// Only the top pick shows reasoning bullets; lower-ranked picks go to
// OtherContenders without reasoning.

interface ReasoningCardProps {
  pick: {
    outcome_label?: string | null;
    outcome_id?: string | null;
    probability?: number;
    reasons?: string[];
  };
  rank?: number;
}

export function ReasoningCard({ pick, rank = 1 }: ReasoningCardProps) {
  const label = pick.outcome_label ?? pick.outcome_id ?? "—";
  const prob = pick.probability ?? 0;
  const pct = Math.round(prob > 1 ? prob : prob * 100);
  const eyebrowText =
    label.length <= 16 ? `WHY ${label.toUpperCase()}` : "WHY THIS PICK";

  return (
    <>
      <div className="section-row">
        <span className="section-eyebrow">{eyebrowText}</span>
        <span className="section-rule" />
      </div>
      <section className="reasoning-card">
        <div className="reasoning-top">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <span className="reasoning-rank">#{rank}</span>
            <span className="reasoning-pick-name truncate">{label}</span>
          </div>
          <span className="reasoning-pct">{pct}%</span>
        </div>
        {pick.reasons && pick.reasons.length > 0 && (
          <ul className="reasoning-bullets">
            {pick.reasons.slice(0, 5).map((r, i) => (
              <li key={i} className="reasoning-bullet">
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
