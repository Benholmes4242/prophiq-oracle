// OddsDisplay — formats a probability as decimal / fractional / American odds.
// Returns null when the resolved format is "percent-only" (politics default)
// or when the probability is non-finite / zero / one (no meaningful odds).

import type { DomainId } from "@/lib/types";
import { useOddsFormat, type OddsFormat } from "@/hooks/useOddsFormat";

interface Props {
  /** Probability on 0-1 OR 0-100 scale (we normalise). */
  probability: number | null | undefined;
  domain: DomainId | null | undefined;
  className?: string;
  /** Force a specific format, ignoring domain + user override. */
  format?: OddsFormat;
}

function toProb01(p: number | null | undefined): number | null {
  if (p == null || !Number.isFinite(p)) return null;
  const v = p > 1 ? p / 100 : p;
  if (v <= 0 || v >= 1) return null;
  return v;
}

export function formatOdds(prob01: number, format: OddsFormat): string | null {
  if (format === "percent-only") return null;
  if (format === "decimal") {
    const dec = 1 / prob01;
    return dec.toFixed(dec >= 10 ? 1 : 2);
  }
  if (format === "american") {
    if (prob01 >= 0.5) {
      const v = Math.round((-100 * prob01) / (1 - prob01));
      return `${v}`;
    }
    const v = Math.round((100 * (1 - prob01)) / prob01);
    return `+${v}`;
  }
  // fractional: best simple ratio approximation of (1-p)/p
  return toFractional(prob01);
}

function toFractional(prob01: number): string {
  const r = (1 - prob01) / prob01;
  // Try clean denominators 1..20, then fall back to 1/N or N/1.
  let best: { num: number; den: number; err: number } | null = null;
  for (let den = 1; den <= 20; den++) {
    const num = Math.round(r * den);
    if (num <= 0) continue;
    const err = Math.abs(num / den - r);
    if (!best || err < best.err) best = { num, den, err };
  }
  if (!best) return `${r.toFixed(2)}/1`;
  return `${best.num}/${best.den}`;
}

export function OddsDisplay({ probability, domain, className, format }: Props) {
  const resolved = useOddsFormat(domain);
  const fmt = format ?? resolved;
  const p = toProb01(probability);
  if (p == null) return null;
  const out = formatOdds(p, fmt);
  if (!out) return null;
  return (
    <span
      className={"font-mono text-[11px] " + (className ?? "")}
      style={{ color: "var(--ink-soft)" }}
      aria-label={`Odds: ${out} (${fmt})`}
    >
      {out}
    </span>
  );
}
