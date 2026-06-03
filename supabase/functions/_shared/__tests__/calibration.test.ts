// Unit tests for calibration math. No DB, no LLM, no network.

import {
  applyCalibration,
  calibrateRankedOutcomes,
  type CalibrationCurve,
  type RankedOutcome,
} from "../calibration.ts";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`ok : ${msg}`); }
  else { failed++; console.error(`FAIL: ${msg}`); }
}
function nearlyEqual(a: number, b: number, eps = 0.001) {
  return Math.abs(a - b) < eps;
}

const curve: CalibrationCurve = {
  domain: "sport",
  version: "test-v1",
  breakpoints: [
    { raw_prob_pct: 0,   calibrated_prob_pct: 0 },
    { raw_prob_pct: 25,  calibrated_prob_pct: 20 },
    { raw_prob_pct: 50,  calibrated_prob_pct: 42 },
    { raw_prob_pct: 75,  calibrated_prob_pct: 70 },
    { raw_prob_pct: 100, calibrated_prob_pct: 100 },
  ],
};

assert(applyCalibration(curve, 0.50) > 0.41 && applyCalibration(curve, 0.50) < 0.43,
  "raw 0.50 maps to ~0.42 (mid-range over-confidence correction)");
assert(nearlyEqual(applyCalibration(curve, 0.25), 0.20),
  "raw 0.25 maps exactly to 0.20 (breakpoint match)");
assert(nearlyEqual(applyCalibration(curve, 0.75), 0.70),
  "raw 0.75 maps exactly to 0.70 (breakpoint match)");
assert(nearlyEqual(applyCalibration(curve, 0), 0),  "0 maps to 0");
assert(nearlyEqual(applyCalibration(curve, 1), 1),  "1 maps to 1");

const midA = applyCalibration(curve, 0.375);
assert(nearlyEqual(midA, 0.31, 0.005),
  `raw 0.375 interpolates to ~0.31 (got ${midA})`);

assert(nearlyEqual(applyCalibration(curve, -0.5), 0), "negative input clamps to 0");
assert(nearlyEqual(applyCalibration(curve,  1.5), 1), "above-1 input clamps to 1");

assert(applyCalibration(null, 0.42) === 0.42, "null curve = identity passthrough");
assert(applyCalibration(null, 0.99) === 0.99, "null curve preserves 0.99");

let monotonicOk = true;
for (let i = 0; i < 50; i++) {
  const a = Math.random() * 0.99;
  const b = a + Math.random() * (1 - a);
  if (applyCalibration(curve, a) > applyCalibration(curve, b) + 1e-9) {
    monotonicOk = false;
    break;
  }
}
assert(monotonicOk, "monotonicity holds across 50 random pairs");

const outcomes: RankedOutcome[] = [
  { outcome_id: "a", outcome_label: "A", rank: 1, probability: 0.50 },
  { outcome_id: "b", outcome_label: "B", rank: 2, probability: 0.30 },
  { outcome_id: "c", outcome_label: "C", rank: 3, probability: 0.20 },
];
const calibrated = calibrateRankedOutcomes(curve, outcomes);
const calibratedSum = calibrated.reduce((s, o) => s + o.probability, 0);
assert(nearlyEqual(calibratedSum, 1.0, 0.001),
  `calibrated sum = 1.0 when raw sum = 1.0 (got ${calibratedSum})`);

assert(calibrated[0].probability > calibrated[1].probability
  && calibrated[1].probability > calibrated[2].probability,
  "calibration preserves ranking (A > B > C still)");

const outcomesWithField: RankedOutcome[] = [
  { outcome_id: "a", outcome_label: "A", rank: 1, probability: 0.40 },
  { outcome_id: "b", outcome_label: "B", rank: 2, probability: 0.10 },
];
const calibratedField = calibrateRankedOutcomes(curve, outcomesWithField);
const calibratedNamedSum = calibratedField.reduce((s, o) => s + o.probability, 0);
assert(nearlyEqual(calibratedNamedSum, 0.50, 0.001),
  `calibrated named sum = 0.50 when raw named sum = 0.50 (got ${calibratedNamedSum})`);

const passthrough = calibrateRankedOutcomes(null, outcomes);
assert(passthrough[0].probability === 0.50, "null curve passes through outcome 0");
assert(passthrough[1].probability === 0.30, "null curve passes through outcome 1");

const empty = calibrateRankedOutcomes(curve, []);
assert(empty.length === 0, "empty input returns empty array");

console.log(`\n${passed} passed, ${failed} failed`);
const proc = (globalThis as { Deno?: { exit(c: number): never } }).Deno;
if (failed > 0 && proc) proc.exit(1);
