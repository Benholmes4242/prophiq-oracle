// OtherContenders — compact list of ranked picks below #1. No bullets, no
// amber percentages — amber is reserved for the top pick to preserve
// editorial hierarchy.

interface Pick {
  outcome_label?: string | null;
  outcome_id?: string | null;
  probability?: number;
}

export function OtherContenders({ picks }: { picks: Pick[] }) {
  if (picks.length === 0) return null;
  return (
    <>
      <div className="section-row">
        <span className="section-eyebrow">OTHER CONTENDERS</span>
        <span className="section-rule" />
      </div>
      <div className="contender-list">
        {picks.slice(0, 4).map((pick, i) => {
          const label = pick.outcome_label ?? pick.outcome_id ?? "—";
          const prob = pick.probability ?? 0;
          const pct = Math.round(prob > 1 ? prob : prob * 100);
          return (
            <div key={`${label}-${i}`} className="contender-card">
              <div className="contender-left min-w-0">
                <span className="contender-rank">#{i + 2}</span>
                <span className="contender-name truncate">{label}</span>
              </div>
              <span className="contender-pct">{pct}%</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
