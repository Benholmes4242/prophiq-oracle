import { FactorIcon, type FactorName } from "./FactorIcon";

const FACTORS: Array<{ icon: FactorName; name: string; desc: string }> = [
  {
    icon: "form",
    name: "Recent form",
    desc: "Recent results and direction of travel, weighted by recency and the calibre of what came before.",
  },
  {
    icon: "history",
    name: "Historical patterns",
    desc: "Long-run base rates from comparable past events — matchups, elections, prints, releases.",
  },
  {
    icon: "signals",
    name: "Real-time signals",
    desc: "Late-breaking news. Injuries, polls, market moves, withdrawals, casting changes — fed in as they happen.",
  },
  {
    icon: "stats",
    name: "Statistical fit",
    desc: "Domain-specific quantitative match — strokes-gained, expected goals, polling weights, macro positioning, opening models.",
  },
];

export function WhatWeAnalyseSection() {
  return (
    <div className="grid grid-cols-1 gap-2.5">
      {FACTORS.map((f) => (
        <div
          key={f.name}
          className="flex items-start gap-3 rounded-xl px-4 py-3.5"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-soft)",
          }}
        >
          <div
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
            style={{ background: "var(--bg-tint)", color: "var(--amber-strong)" }}
          >
            <FactorIcon name={f.icon} />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="font-display text-[14.5px] leading-tight"
              style={{ fontWeight: 700 }}
            >
              {f.name}
            </div>
            <div
              className="font-body mt-1 text-[12.5px] leading-snug"
              style={{ color: "var(--ink-soft)" }}
            >
              {f.desc}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
