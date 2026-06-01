// Public-facing confidence indicator. Hides "X of N models agree" math
// behind a calibrated-sounding HIGH / MEDIUM / MIXED label.

type Tier = "high" | "medium" | "mixed";

const LABELS: Record<Tier, string> = {
  high: "HIGH",
  medium: "MEDIUM",
  mixed: "MIXED",
};

const COLORS: Record<Tier, string> = {
  high: "var(--green)",
  medium: "var(--amber)",
  mixed: "var(--amber-strong)",
};

function nToTier(n: number): Tier {
  if (n >= 3) return "high";
  if (n === 2) return "medium";
  return "mixed";
}

/**
 * Map internal 0-100 agreement_score → public tier.
 * 80+ = HIGH, 50-79 = MEDIUM, anything else (or null) = MIXED.
 */
export function tierFromScore(score: number | null | undefined): Tier {
  if (score == null) return "mixed";
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "mixed";
}

interface Props {
  /** Number of models in agreement (1–3). If you have an agreement_score
   *  (0–100), pass `score` instead. */
  n?: number;
  /** Internal agreement_score on a 0–100 scale. */
  score?: number | null;
  compact?: boolean;
  className?: string;
}

export function ConfidenceLabel({ n, score, compact = false, className }: Props) {
  const tier: Tier =
    typeof n === "number" ? nToTier(n) : tierFromScore(score ?? null);
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
