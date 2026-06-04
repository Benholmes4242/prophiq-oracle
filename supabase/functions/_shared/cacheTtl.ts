// Single source of truth for prediction cache TTL. Brief FF v2 / Phase D.1.
// Both submit-question (newly-generated predictions) and generate-prediction
// (cached read path) MUST import from here so the values cannot drift.
export const PREDICTION_CACHE_TTL_HOURS = 12;
export const PREDICTION_CACHE_TTL_MS =
  PREDICTION_CACHE_TTL_HOURS * 60 * 60 * 1000;
