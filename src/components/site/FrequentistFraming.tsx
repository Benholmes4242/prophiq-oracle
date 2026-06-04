// FrequentistFraming — "Imagining this race or match run 100 times…" copy
// that grounds the percentage bars in concrete frequencies. Rendered below
// CallSection on parent events with 3+ named outcomes. Skipped for binary
// children where the framing adds no information.

import type { DomainId, RankedOutcome } from "@/lib/types";
import { FIELD_LABEL_PATTERN } from "@/components/site/CallSection";

interface Props {
  picks: RankedOutcome[];
  domain: DomainId | null | undefined;
}

const VERB: Record<DomainId, string> = {
  sport: "race or match",
  politics: "contest",
  markets: "scenario",
  entertainment: "ceremony",
};

function pct(p: number | undefined): number {
  const v = p ?? 0;
  return Math.round(v > 1 ? v : v * 100);
}

export function FrequentistFraming({ picks, domain }: Props) {
  const named = picks
    .filter((p) => !FIELD_LABEL_PATTERN.test((p.outcome_label ?? "").trim()))
    .map((p) => ({
      label: p.outcome_label ?? p.outcome_id ?? "—",
      pct: pct(p.probability),
    }))
    .sort((a, b) => b.pct - a.pct);

  if (named.length < 3) return null;

  const top3 = named.slice(0, 3);
  const rest = named.slice(3);
  const top3Sum = top3.reduce((s, x) => s + x.pct, 0);
  const restWins = Math.max(0, 100 - top3Sum);
  const verb = VERB[(domain ?? "sport") as DomainId] ?? "scenario";

  return (
    <p
      className="mt-3 mb-6 font-body"
      style={{
        fontSize: "13.5px",
        lineHeight: 1.55,
        color: "var(--ink-soft)",
      }}
    >
      Imagining this {verb} run 100 times:{" "}
      {top3.map((x, i) => (
        <span key={i}>
          <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
            {x.label}
          </strong>{" "}
          wins {x.pct}
          {i < top3.length - 1 ? (i === top3.length - 2 ? ", and " : ", ") : ""}
        </span>
      ))}
      .{" "}
      {rest.length > 0 && restWins > 0 && (
        <>
          The other {rest.length} {rest.length === 1 ? "outcome shares" : "outcomes share"} the
          remaining {restWins} wins.
        </>
      )}
    </p>
  );
}
