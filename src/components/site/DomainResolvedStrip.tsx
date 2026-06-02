import { ScoredYesterday, ScoredYesterdayHeader } from "./ScoredYesterday";
import type { ScoredPick } from "@/lib/queries";

export function DomainResolvedStrip({ picks }: { picks: ScoredPick[] }) {
  return (
    <>
      <div className="pb-3">
        <ScoredRecentlyHeader picks={picks} />
      </div>
      <ScoredYesterday picks={picks} />
    </>
  );
}

function ScoredRecentlyHeader({ picks }: { picks: ScoredPick[] }) {
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
        Scored recently
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

export { ScoredYesterdayHeader };
