-- Brief GG Phase A: lineage column for multi-source structured data.
-- Each successful prediction records which Brief GG sources contributed
-- (name + fetched_at + duration_ms), independent of the legacy single-source
-- `structured_data_used` column populated by api-sports.

ALTER TABLE prediction_inputs
  ADD COLUMN IF NOT EXISTS structured_data_sources jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN prediction_inputs.structured_data_sources IS
  'Brief GG: list of structured-data sources that contributed to this forecast. Shape: [{ name, fetched_at, duration_ms }]. Empty array when no adapter implemented gatherStructuredSources or all sources failed.';
