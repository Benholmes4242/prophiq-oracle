-- =============================================================================
-- Prophiq cleanup: duplicate is_current predictions
-- =============================================================================
-- Symptom: occasionally two predictions for the same (event_id, mode) both
-- have is_current = true. The retry logic in generate-prediction and
-- submit-question relies on a PARTIAL UNIQUE INDEX on
-- predictions(event_id, mode) WHERE is_current to raise 23505 and fire the
-- single-retry. If no such index is live, nothing catches the race and
-- duplicate "current" rows slip through.
--
-- Ben: run this whole file in the Supabase SQL editor. It is idempotent and
-- safe to run more than once. Read the output of step (1) BEFORE the
-- COMMIT decision in step (4).
-- =============================================================================

-- ----- (1) DIAGNOSE: which (if any) partial unique index already exists? ----
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'predictions'
  AND indexdef ILIKE '%is_current%';

-- ----- (2) DIAGNOSE: are there ACTUAL duplicates right now? -----------------
SELECT event_id, mode, COUNT(*) AS current_count
FROM predictions
WHERE is_current = true
GROUP BY event_id, mode
HAVING COUNT(*) > 1
ORDER BY current_count DESC;

-- ----- (3) FIX: dedupe + ensure the partial unique index ---------------------
-- Wrapped in a transaction so the dedupe + index creation either both apply
-- or neither does. The UPDATE is a no-op when no duplicates exist; the
-- CREATE INDEX is idempotent via IF NOT EXISTS.
BEGIN;

-- Demote all but the newest is_current per (event_id, mode). Tie-break on id
-- so the result is deterministic.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY event_id, mode ORDER BY generated_at DESC, id DESC
  ) AS rn
  FROM predictions
  WHERE is_current = true
)
UPDATE predictions p
SET is_current = false
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

-- Create the partial unique index if it isn't already live. This is the
-- guard the retry logic depends on.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_current_prediction
  ON predictions (event_id, mode) WHERE is_current;

-- ----- (4) VERIFY before COMMIT ---------------------------------------------
-- Both of the following should now return ZERO rows:
SELECT event_id, mode, COUNT(*) AS current_count
FROM predictions
WHERE is_current = true
GROUP BY event_id, mode
HAVING COUNT(*) > 1;

-- And the index should be visible:
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'predictions'
  AND indexname IN ('uq_predictions_current', 'uniq_current_prediction');

COMMIT;

-- =============================================================================
-- Notes
-- =============================================================================
-- - If two index names show up (uq_predictions_current AND
--   uniq_current_prediction), that is harmless: two identical guards. Do NOT
--   drop both. If you want to tidy, drop ONE only after confirming the other
--   is UNIQUE and partial (WHERE is_current).
-- - If step (2) showed duplicates AND step (1) showed an index that is NOT
--   UNIQUE or NOT partial, the IF NOT EXISTS above will silently skip it.
--   In that rare case, drop the non-unique one first (DROP INDEX <name>;)
--   and re-run this script.
-- - No code change in submit-question / generate-prediction is required:
--   their flip-then-insert-with-23505-retry already does the right thing
--   once the partial unique index is in place.
-- =============================================================================
