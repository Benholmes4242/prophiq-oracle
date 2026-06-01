import { ScoredYesterday, ScoredYesterdayHeader } from "./ScoredYesterday";
import type { ScoredPick } from "@/lib/queries";

export function DomainResolvedStrip({ picks }: { picks: ScoredPick[] }) {
  return (
    <>
      <div className="pb-2">
        <ScoredYesterdayHeaderWithLabel picks={picks} />
      </div>
      <ScoredYesterday picks={picks} />
    </>
  );
}

function ScoredYesterdayHeaderWithLabel({ picks }: { picks: ScoredPick[] }) {
  // Reuse the same visual header but with the "SCORED RECENTLY" label per brief.
  const correct = picks.filter((p) => p.correct).length;
  return (
    <div className="flex items-center gap-3">
      <span
        className="font-mono text-[10px] tracking-[0.2em]"
        style={{ color: "var(--ink-faint)", fontWeight: 600 }}
      >
        SCORED RECENTLY
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
          {correct}/{picks.length} correct
        </span>
      )}
    </div>
  );
}

// Re-export header in case route files want it standalone.
export { ScoredYesterdayHeader };
