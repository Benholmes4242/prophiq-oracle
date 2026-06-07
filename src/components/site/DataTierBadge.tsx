// Honest data-quality label for a forecast. The trust layer classifies every
// forecast into one of three tiers:
//   - feed_backed       — at least one structured feed returned real data
//   - research_grounded — no feed, but substantive live web research
//   - low_data          — neither; forecast is honest but uncertain
//
// We render nothing for the default `feed_backed` case so the badge only
// appears when the user benefits from extra signal (research-only) or
// caution (low data).

import type { DataTier } from "@/lib/types";

export function DataTierBadge({ tier }: { tier: DataTier | null | undefined }) {
  if (!tier || tier === "feed_backed") return null;

  const isLow = tier === "low_data";
  const label = isLow ? "Limited data available" : "Based on live research";
  const accent = isLow ? "var(--amber-strong)" : "var(--ink-soft)";
  const background = isLow ? "var(--bg-tint)" : "var(--bg-card)";
  const border = isLow ? "var(--amber)" : "var(--border-soft)";

  return (
    <span
      className="font-mono inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
      style={{ background, color: accent, borderColor: border }}
      title={
        isLow
          ? "Neither a structured data feed nor substantive live research was available for this event. The forecast reflects baseline uncertainty rather than verified evidence."
          : "No structured data feed is wired for this event yet. The forecast was grounded in live web research."
      }
    >
      {label}
    </span>
  );
}
