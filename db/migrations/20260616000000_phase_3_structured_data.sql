-- Phase 3: Structured data feeds per domain.
--
-- One table (event_structured_data) for the per-event cache, one view for
-- freshest reads, one column on prediction_inputs for lineage capture.

-- ============================================================
-- 1. event_structured_data - per-event cache
-- ============================================================
CREATE TABLE event_structured_data (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source          text NOT NULL,
  source_version  text NOT NULL,
  payload         jsonb NOT NULL,
  summary_lines   text[] NOT NULL DEFAULT '{}',
  fetched_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_structured_data_event_fetched
  ON event_structured_data(event_id, fetched_at DESC);
CREATE INDEX idx_event_structured_data_source
  ON event_structured_data(source);

COMMENT ON TABLE event_structured_data IS 'Per-event structured-data payloads from external providers (API-Sports for football v1, FRED/polling/TMDB in future). Refreshed inline by generate-prediction with a 1-hour cache TTL. Powers the STRUCTURED DATA prompt block.';

GRANT SELECT ON event_structured_data TO anon, authenticated;
GRANT ALL    ON event_structured_data TO service_role;

ALTER TABLE event_structured_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_structured_data_public_read"
  ON event_structured_data FOR SELECT USING (true);

-- ============================================================
-- 2. event_structured_data_latest view
-- ============================================================
CREATE OR REPLACE VIEW event_structured_data_latest AS
SELECT DISTINCT ON (event_id, source)
  event_id, source, source_version, payload, summary_lines, fetched_at
FROM event_structured_data
ORDER BY event_id, source, fetched_at DESC;

GRANT SELECT ON event_structured_data_latest TO anon, authenticated, service_role;

-- ============================================================
-- 3. prediction_inputs gets a structured_data_used column
-- ============================================================
ALTER TABLE prediction_inputs
  ADD COLUMN IF NOT EXISTS structured_data_used jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN prediction_inputs.structured_data_used IS 'Summary of structured-data payload injected into this forecast. Empty object when no structured data was injected. Shape: { source, source_version, fetched_at, age_minutes_at_call, line_count }.';
