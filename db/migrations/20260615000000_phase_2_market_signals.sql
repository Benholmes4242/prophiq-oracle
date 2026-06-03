-- Phase 2: Real-time market signals integration (Brief Y).

-- ============================================================
-- 1. event_market_mappings - persistent matched-market record
-- ============================================================
CREATE TABLE event_market_mappings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  venue               text NOT NULL CHECK (venue IN ('polymarket','kalshi','betfair','manifold')),
  market_id           text NOT NULL,
  market_question     text NOT NULL,
  matched_outcome_id  uuid REFERENCES event_outcomes(id) ON DELETE SET NULL,
  match_confidence    numeric NOT NULL CHECK (match_confidence >= 0 AND match_confidence <= 1),
  matcher_version     text NOT NULL DEFAULT 'v1-entity-overlap',
  matched_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, venue, market_id)
);

CREATE INDEX idx_event_market_mappings_event ON event_market_mappings(event_id);
CREATE INDEX idx_event_market_mappings_venue ON event_market_mappings(venue);

COMMENT ON TABLE event_market_mappings IS 'Persistent record of which prediction market venue+market_id are matched to which Prophiq event.';

-- ============================================================
-- 2. market_signals - per-fetch price snapshot
-- ============================================================
CREATE TABLE market_signals (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                 uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  mapping_id               uuid REFERENCES event_market_mappings(id) ON DELETE CASCADE,
  venue                    text NOT NULL,
  market_id                text NOT NULL,
  market_outcome_label     text NOT NULL,
  implied_probability      numeric NOT NULL CHECK (implied_probability >= 0 AND implied_probability <= 1),
  volume_usd               numeric,
  fetched_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_market_signals_event_fetched ON market_signals(event_id, fetched_at DESC);
CREATE INDEX idx_market_signals_venue ON market_signals(venue);

COMMENT ON TABLE market_signals IS 'Per-event price snapshots from prediction markets. Refreshed inline by generate-prediction with a 30-minute cache TTL.';

-- ============================================================
-- 3. prediction_inputs gets a market_signals_used column
-- ============================================================
ALTER TABLE prediction_inputs
  ADD COLUMN IF NOT EXISTS market_signals_used jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN prediction_inputs.market_signals_used IS 'Summary of market signals injected into this forecast.';

-- ============================================================
-- 4. Permissions + RLS
-- ============================================================
GRANT SELECT ON event_market_mappings TO anon, authenticated;
GRANT SELECT ON market_signals        TO anon, authenticated;
GRANT ALL    ON event_market_mappings TO service_role;
GRANT ALL    ON market_signals        TO service_role;

ALTER TABLE event_market_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_signals        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_market_mappings_public_read"
  ON event_market_mappings FOR SELECT USING (true);
CREATE POLICY "market_signals_public_read"
  ON market_signals FOR SELECT USING (true);

-- ============================================================
-- 5. Convenience view: latest market signal per (event, outcome)
-- ============================================================
CREATE OR REPLACE VIEW market_signals_latest AS
SELECT DISTINCT ON (event_id, market_outcome_label)
  event_id,
  venue,
  market_id,
  market_outcome_label,
  implied_probability,
  volume_usd,
  fetched_at
FROM market_signals
ORDER BY event_id, market_outcome_label, fetched_at DESC;

GRANT SELECT ON market_signals_latest TO anon, authenticated, service_role;
