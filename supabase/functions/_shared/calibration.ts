// Phase 1: Post-hoc calibration mapping.
//
// Pulls the latest calibration curve breakpoints from the database, then
// applies linear interpolation locally in TypeScript. We read the curve
// once per request (per domain) and apply it to all outcomes - avoiding
// per-outcome RPC round-trips.

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface CalibrationBreakpoint {
  raw_prob_pct: number;
  calibrated_prob_pct: number;
}

export interface CalibrationCurve {
  domain: string;
  version: string;
  breakpoints: CalibrationBreakpoint[];
}

export interface RankedOutcome {
  outcome_id: string;
  outcome_label?: string;
  rank: number;
  probability: number;
  fit_score?: number;
  reasons?: string[];
  is_dark_horse?: boolean;
}

/**
 * Load the latest calibration curve for a domain. Returns null if no curve
 * exists yet (caller should treat as identity passthrough).
 */
export async function loadCalibrationCurve(
  supabase: SupabaseClient,
  domain: string,
): Promise<CalibrationCurve | null> {
  const { data: versionRow, error: vErr } = await supabase
    .from("calibration_curves")
    .select("version")
    .eq("domain", domain)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (vErr || !versionRow) return null;

  const { data: bps, error: bErr } = await supabase
    .from("calibration_curves")
    .select("raw_prob_pct, calibrated_prob_pct")
    .eq("domain", domain)
    .eq("version", versionRow.version)
    .order("raw_prob_pct", { ascending: true });

  if (bErr || !bps || bps.length < 2) return null;

  return {
    domain,
    version: versionRow.version,
    breakpoints: bps.map((b) => ({
      raw_prob_pct: Number(b.raw_prob_pct),
      calibrated_prob_pct: Number(b.calibrated_prob_pct),
    })),
  };
}

/**
 * Apply the calibration curve to a single 0..1 probability via linear
 * interpolation between bracketing breakpoints. Returns input unchanged
 * if the curve is null/empty.
 */
export function applyCalibration(
  curve: CalibrationCurve | null,
  rawProb: number,
): number {
  if (!curve || curve.breakpoints.length < 2) return rawProb;
  if (!Number.isFinite(rawProb)) return rawProb;

  const rawPct = Math.max(0, Math.min(100, rawProb * 100));

  let lo = curve.breakpoints[0];
  let hi = curve.breakpoints[curve.breakpoints.length - 1];
  for (let i = 0; i < curve.breakpoints.length - 1; i++) {
    if (
      curve.breakpoints[i].raw_prob_pct <= rawPct &&
      curve.breakpoints[i + 1].raw_prob_pct >= rawPct
    ) {
      lo = curve.breakpoints[i];
      hi = curve.breakpoints[i + 1];
      break;
    }
  }

  const span = hi.raw_prob_pct - lo.raw_prob_pct;
  if (span <= 0) return lo.calibrated_prob_pct / 100;

  const t = (rawPct - lo.raw_prob_pct) / span;
  const calibratedPct = lo.calibrated_prob_pct
    + t * (hi.calibrated_prob_pct - lo.calibrated_prob_pct);

  return Math.max(0, Math.min(1, calibratedPct / 100));
}

/**
 * Apply calibration to all named outcomes in a ranked list, then renormalise
 * so the named outcomes sum to (1 - field_share). Preserves implicit field
 * mass left unallocated by the consensus engine. Returns a new array.
 */
export function calibrateRankedOutcomes(
  curve: CalibrationCurve | null,
  outcomes: RankedOutcome[],
): RankedOutcome[] {
  if (!curve || outcomes.length === 0) return outcomes;

  const rawSum = outcomes.reduce((s, o) => s + (o.probability ?? 0), 0);
  const fieldShare = Math.max(0, 1 - rawSum);
  const targetNamedSum = 1 - fieldShare;

  const calibratedRaw = outcomes.map((o) => applyCalibration(curve, o.probability ?? 0));
  const calibratedSum = calibratedRaw.reduce((s, p) => s + p, 0);

  if (calibratedSum <= 0) return outcomes;

  const scale = targetNamedSum / calibratedSum;
  return outcomes.map((o, i) => ({
    ...o,
    probability: calibratedRaw[i] * scale,
  }));
}
