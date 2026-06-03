// CallSection — the ranked outcomes card on the event detail page. Replaces
// the embedded hero pick row + ReasoningCard outcome header + OtherContenders
// list. Single white card with proportional bars, distinct top-pick styling,
// and a conditional "Rest of the field" row for incomplete probability spaces.

import { Link } from "@tanstack/react-router";

interface RankedOutcome {
  outcome_label?: string | null;
  outcome_id?: string | null;
  probability?: number;
}

interface CallSectionProps {
  picks: RankedOutcome[];
  heading: string;
  totalNamedTeamsHint?: number;
}

export const FIELD_LABEL_PATTERN = /^(other team|other|field|remaining|other outcomes?)$/i;
const FIELD_DISPLAY_LABEL = "Rest of the field";
const FIELD_ROW_THRESHOLD_PCT = 10;
const MAX_NAMED_ROWS = 6;

interface NormalisedPick extends RankedOutcome {
  pct: number;
}

export function CallSection({ picks, heading, totalNamedTeamsHint }: CallSectionProps) {
  const namedPicks: NormalisedPick[] = [];
  let backendFieldPct: number | null = null;

  for (const pick of picks) {
    const label = pick.outcome_label ?? pick.outcome_id ?? "";
    const prob = pick.probability ?? 0;
    const pct = Math.round(prob > 1 ? prob : prob * 100);
    if (FIELD_LABEL_PATTERN.test(label.trim())) {
      backendFieldPct = (backendFieldPct ?? 0) + pct;
    } else {
      namedPicks.push({ ...pick, pct });
    }
  }

  namedPicks.sort((a, b) => b.pct - a.pct);
  const displayedNamed = namedPicks.slice(0, MAX_NAMED_ROWS);

  const namedSum = namedPicks.reduce((s, p) => s + p.pct, 0);
  const syntheticFieldPct = Math.max(0, 100 - namedSum);
  const fieldPct = backendFieldPct ?? syntheticFieldPct;
  const showFieldRow = fieldPct >= FIELD_ROW_THRESHOLD_PCT;

  return (
    <>
      <section className="call-section">
        <p className="call-heading">{heading}</p>

        <div className="call-list">
          {displayedNamed.map((pick, i) => {
            const label = pick.outcome_label ?? pick.outcome_id ?? "—";
            return (
              <Row
                key={`${label}-${i}`}
                rank={i + 1}
                label={label}
                pct={pick.pct}
                isTop={i === 0}
              />
            );
          })}
          {showFieldRow && (
            <FieldRow
              pct={fieldPct}
              namedShownCount={displayedNamed.length}
              totalNamedHint={totalNamedTeamsHint}
            />
          )}
        </div>
      </section>

      <div className="call-help-row">
        <Link to="/how-it-works" className="call-help-link">
          How to read these probabilities →
        </Link>
      </div>
    </>
  );
}

function Row({
  rank,
  label,
  pct,
  isTop,
}: {
  rank: number;
  label: string;
  pct: number;
  isTop: boolean;
}) {
  return (
    <div className={isTop ? "call-row call-row-top" : "call-row"}>
      <div className="call-row-meta">
        <span className="call-rank">#{rank}</span>
        <span className="call-name truncate">{label}</span>
        <span className="call-pct">
          {pct}
          <span className="call-pct-unit">%</span>
        </span>
      </div>
      <div className="call-bar">
        <div className="call-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FieldRow({
  pct,
  namedShownCount,
  totalNamedHint,
}: {
  pct: number;
  namedShownCount: number;
  totalNamedHint?: number;
}) {
  let note: string;
  if (totalNamedHint && totalNamedHint > namedShownCount) {
    const remaining = totalNamedHint - namedShownCount;
    note = `Combined probability across ${remaining} other ${remaining === 1 ? "outcome" : "outcomes"}.`;
  } else {
    note = "Combined probability across all other possible outcomes.";
  }

  return (
    <div className="call-row call-row-field">
      <div className="call-row-meta">
        <span className="call-rank">–</span>
        <span className="call-name call-name-field">{FIELD_DISPLAY_LABEL}</span>
        <span className="call-pct call-pct-field">
          {pct}
          <span className="call-pct-unit">%</span>
        </span>
      </div>
      <div className="call-bar">
        <div className="call-bar-fill call-bar-fill-field" style={{ width: `${pct}%` }} />
      </div>
      <p className="call-field-note">{note}</p>
    </div>
  );
}
