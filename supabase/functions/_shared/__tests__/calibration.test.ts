// Unit tests for calibration math. No DB, no LLM, no network.
//
// The pipeline uses the 0–100 percent scale end to end (LLM normalisation,
// consensus engine, calibration, predictions table, UI). These tests pin
// that contract.

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
function nearlyEqual(a: number, b: number, eps = 0.1) {
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

assert(applyCalibration(curve, 50) > 41 && applyCalibration(curve, 50) < 43,
  "raw 50 maps to ~42 (mid-range over-confidence correction)");
assert(nearlyEqual(applyCalibration(curve, 25), 20),
  "raw 25 maps exactly to 20 (breakpoint match)");
assert(nearlyEqual(applyCalibration(curve, 75), 70),
  "raw 75 maps exactly to 70 (breakpoint match)");
assert(nearlyEqual(applyCalibration(curve, 0), 0),  "0 maps to 0");
assert(nearlyEqual(applyCalibration(curve, 100), 100),  "100 maps to 100");

const midA = applyCalibration(curve, 37.5);
assert(nearlyEqual(midA, 31, 0.5),
  `raw 37.5 interpolates to ~31 (got ${midA})`);

assert(nearlyEqual(applyCalibration(curve, -50), 0), "negative input clamps to 0");
assert(nearlyEqual(applyCalibration(curve, 150), 100), "above-100 input clamps to 100");

assert(applyCalibration(null, 42) === 42, "null curve = identity passthrough");
assert(applyCalibration(null, 99) === 99, "null curve preserves 99");

let monotonicOk = true;
for (let i = 0; i < 50; i++) {
  const a = Math.random() * 99;
  const b = a + Math.random() * (100 - a);
  if (applyCalibration(curve, a) > applyCalibration(curve, b) + 1e-9) {
    monotonicOk = false;
    break;
  }
}
assert(monotonicOk, "monotonicity holds across 50 random pairs");

// Outcomes sum to 100 (field share 0) → calibrated set also sums to 100.
const outcomes: RankedOutcome[] = [
  { outcome_id: "a", outcome_label: "A", rank: 1, probability: 50 },
  { outcome_id: "b", outcome_label: "B", rank: 2, probability: 30 },
  { outcome_id: "c", outcome_label: "C", rank: 3, probability: 20 },
];
const calibrated = calibrateRankedOutcomes(curve, outcomes);
const calibratedSum = calibrated.reduce((s, o) => s + o.probability, 0);
assert(nearlyEqual(calibratedSum, 100, 0.1),
  `calibrated sum = 100 when raw sum = 100 (got ${calibratedSum})`);

assert(calibrated[0].probability > calibrated[1].probability
  && calibrated[1].probability > calibrated[2].probability,
  "calibration preserves ranking (A > B > C still)");

// Field share preserved when raw named sum is below 100.
const outcomesWithField: RankedOutcome[] = [
  { outcome_id: "a", outcome_label: "A", rank: 1, probability: 40 },
  { outcome_id: "b", outcome_label: "B", rank: 2, probability: 10 },
];
const calibratedField = calibrateRankedOutcomes(curve, outcomesWithField);
const calibratedNamedSum = calibratedField.reduce((s, o) => s + o.probability, 0);
assert(nearlyEqual(calibratedNamedSum, 50, 0.1),
  `calibrated named sum = 50 when raw named sum = 50 (got ${calibratedNamedSum})`);

// Over-100 raw sum (pre-normalisation regression) should still produce a
// valid distribution rather than negative field share.
const overshoot: RankedOutcome[] = [
  { outcome_id: "a", outcome_label: "A", rank: 1, probability: 100 },
  { outcome_id: "b", outcome_label: "B", rank: 2, probability: 70 },
  { outcome_id: "c", outcome_label: "C", rank: 3, probability: 2 },
];
const calibratedOver = calibrateRankedOutcomes(curve, overshoot);
const calibratedOverSum = calibratedOver.reduce((s, o) => s + o.probability, 0);
assert(calibratedOverSum > 0 && calibratedOverSum <= 100.0001,
  `over-100 raw sum yields valid calibrated sum <= 100 (got ${calibratedOverSum})`);

const passthrough = calibrateRankedOutcomes(null, outcomes);
assert(passthrough[0].probability === 50, "null curve passes through outcome 0");
assert(passthrough[1].probability === 30, "null curve passes through outcome 1");

const empty = calibrateRankedOutcomes(curve, []);
assert(empty.length === 0, "empty input returns empty array");

console.log(`\n${passed} passed, ${failed} failed`);
const proc = (globalThis as { Deno?: { exit(c: number): never } }).Deno;
if (failed > 0 && proc) proc.exit(1);
