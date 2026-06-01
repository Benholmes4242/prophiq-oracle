// Public-facing confidence indicator. Accepts a server-mapped tier; the
// 0–100 → tier mapping lives in SQL (public.score_to_confidence) and is
// no longer recomputed on the client.

import type { ConfidenceTier } from "@/lib/types";

const LABELS: Record<ConfidenceTier, string> = {
  high: "HIGH",
  medium: "MEDIUM",
  mixed: "MIXED",
};

const COLORS: Record<ConfidenceTier, string> = {
  high: "var(--green)",
  medium: "var(--amber)",
  mixed: "var(--amber-strong)",
};

interface Props {
  tier: ConfidenceTier;
  compact?: boolean;
  className?: string;
}

export function ConfidenceLabel({ tier, compact = false, className }: Props) {
  const color = COLORS[tier];
  const label = LABELS[tier];

  if (compact) {
    return (
      <span
        className={"inline-block rounded-full " + (className ?? "")}
        style={{ width: 8, height: 8, background: color }}
        aria-label={`${label} confidence`}
      />
    );
  }

  return (
    <div className={"inline-flex items-center gap-1.5 " + (className ?? "")}>
      <span
        className="inline-block rounded-full"
        style={{ width: 6, height: 6, background: color }}
      />
      <span
        className="font-mono text-[9.5px] font-bold tracking-[0.2em]"
        style={{ color: "var(--ink-soft)" }}
      >
        {label}
      </span>
    </div>
  );
}
