-- Prophiq schema: events, predictions, resolutions, accuracy, chat, rate limits.
-- All tables are public-readable (where moderation allows); writes are service_role only.

-- ============================================================
-- EVENTS
-- ============================================================
CREATE TABLE events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain                   text NOT NULL,
  external_id              text,
  slug                     text NOT NULL UNIQUE,
  title                    text NOT NULL,
  description              text,
  question                 text NOT NULL,
  starts_at                timestamptz NOT NULL,
  resolves_at              timestamptz NOT NULL,
  status                   text NOT NULL DEFAULT 'scheduled'
                             CHECK (status IN ('scheduled','live','resolved','cancelled')),
  mode                     text NOT NULL DEFAULT 'prediction'
                             CHECK (mode IN ('prediction','odds','both')),
  source                   text NOT NULL DEFAULT 'discovered'
                             CHECK (source IN ('discovered','user_submitted')),
  submitted_by_fingerprint text,
  submitted_at             timestamptz,
  moderation_status        text NOT NULL DEFAULT 'approved'
                             CHECK (moderation_status IN ('pending','approved','rejected')),
  moderation_reason        text,
  moderation_metadata      jsonb,
  metadata                 jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE(domain, external_id)
);

CREATE INDEX idx_events_status_starts            ON events(status, starts_at);
CREATE INDEX idx_events_domain_status_starts     ON events(domain, status, starts_at DESC);
CREATE INDEX idx_events_mode                     ON events(mode) WHERE status = 'scheduled';
CREATE INDEX idx_events_source_status            ON events(source, status, moderation_status);
CREATE INDEX idx_events_resolves_at              ON events(resolves_at) WHERE status IN ('scheduled','live');

-- ============================================================
-- EVENT_OUTCOMES
-- ============================================================
CREATE TABLE event_outcomes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  external_id text,
  label       text NOT NULL,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, external_id)
);
CREATE INDEX idx_outcomes_event ON event_outcomes(event_id);

-- ============================================================
-- PREDICTIONS
-- ============================================================
CREATE TABLE predictions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  mode               text NOT NULL CHECK (mode IN ('prediction','odds')),
  ranked_outcomes    jsonb NOT NULL,
  alternates         jsonb,
  consensus_method   text NOT NULL
                       CHECK (consensus_method IN ('weighted_borda_count','single_model_fallback')),
  consensus_score    numeric,
  agreement_score    int,
  model_results      jsonb NOT NULL,
  research_context   jsonb,
  prompt_version     text NOT NULL,
  is_current         boolean NOT NULL DEFAULT true,
  generated_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz
);

CREATE UNIQUE INDEX uq_predictions_current
  ON predictions(event_id, mode) WHERE is_current = true;
CREATE INDEX idx_predictions_event_generated
  ON predictions(event_id, generated_at DESC);

-- ============================================================
-- EVENT_RESOLUTIONS
-- ============================================================
CREATE TABLE event_resolutions (
  event_id           uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  outcome_rankings   jsonb NOT NULL,
  source             text,
  resolution_context text,
  resolved_at        timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- PREDICTION_ACCURACY
-- ============================================================
CREATE TABLE prediction_accuracy (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id          uuid NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  event_id               uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  domain                 text NOT NULL,
  mode                   text NOT NULL,
  pick_results           jsonb NOT NULL,
  top_pick_correct       boolean,
  picks_in_top_3         int DEFAULT 0,
  picks_in_top_5         int DEFAULT 0,
  picks_in_top_10        int DEFAULT 0,
  best_pick_actual_rank  int,
  average_predicted_rank numeric,
  average_actual_rank    numeric,
  accuracy_grade         text
                           CHECK (accuracy_grade IN ('excellent','good','mixed','poor')),
  domain_metrics         jsonb,
  prompt_version         text,
  consensus_method       text,
  scored_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, mode)
);
CREATE INDEX idx_accuracy_domain_scored ON prediction_accuracy(domain, scored_at DESC);

-- ============================================================
-- CHAT_THREADS
-- ============================================================
CREATE TABLE chat_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  prediction_id   uuid REFERENCES predictions(id) ON DELETE SET NULL,
  fingerprint     text NOT NULL,
  message_count   int NOT NULL DEFAULT 0,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_threads_event       ON chat_threads(event_id);
CREATE INDEX idx_chat_threads_fingerprint ON chat_threads(fingerprint, last_message_at DESC);

-- ============================================================
-- CHAT_MESSAGES
-- ============================================================
CREATE TABLE chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('user','assistant','system')),
  content    text NOT NULL,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_thread ON chat_messages(thread_id, created_at);

-- ============================================================
-- SUBMISSION_RATE_LIMITS — audit ledger (no public read)
-- ============================================================
CREATE TABLE submission_rate_limits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint  text NOT NULL,
  ip_hash      text NOT NULL,
  endpoint     text NOT NULL,
  question     text NOT NULL,
  outcome      text NOT NULL CHECK (outcome IN ('accepted','rejected_moderation','rejected_rate_limit','failed')),
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rate_limit_fp_endpoint_time ON submission_rate_limits(fingerprint, endpoint, submitted_at);
CREATE INDEX idx_rate_limit_ip_time          ON submission_rate_limits(ip_hash, submitted_at);

-- ============================================================
-- GRANTS — explicit, per Supabase Data API requirements
-- ============================================================
GRANT SELECT ON events              TO anon, authenticated;
GRANT SELECT ON event_outcomes      TO anon, authenticated;
GRANT SELECT ON predictions         TO anon, authenticated;
GRANT SELECT ON event_resolutions   TO anon, authenticated;
GRANT SELECT ON prediction_accuracy TO anon, authenticated;
GRANT SELECT ON chat_threads        TO anon, authenticated;
GRANT SELECT ON chat_messages       TO anon, authenticated;
-- submission_rate_limits: no anon/authenticated grant; service_role only.

GRANT ALL ON events                 TO service_role;
GRANT ALL ON event_outcomes         TO service_role;
GRANT ALL ON predictions            TO service_role;
GRANT ALL ON event_resolutions      TO service_role;
GRANT ALL ON prediction_accuracy    TO service_role;
GRANT ALL ON chat_threads           TO service_role;
GRANT ALL ON chat_messages          TO service_role;
GRANT ALL ON submission_rate_limits TO service_role;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE events                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_outcomes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_resolutions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_accuracy    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_threads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_public_read"        ON events              FOR SELECT USING (moderation_status = 'approved');
CREATE POLICY "outcomes_public_read"      ON event_outcomes      FOR SELECT USING (true);
CREATE POLICY "predictions_public_read"   ON predictions         FOR SELECT USING (true);
CREATE POLICY "resolutions_public_read"   ON event_resolutions   FOR SELECT USING (true);
CREATE POLICY "accuracy_public_read"      ON prediction_accuracy FOR SELECT USING (true);
CREATE POLICY "chat_threads_public_read"  ON chat_threads        FOR SELECT USING (true);
CREATE POLICY "chat_messages_public_read" ON chat_messages       FOR SELECT USING (true);
-- submission_rate_limits: no SELECT policy (audit table)

-- ============================================================
-- VIEWS — homepage stats + track record
-- ============================================================
CREATE OR REPLACE VIEW v_domain_pick_record AS
SELECT
  pa.domain,
  pa.mode,
  date_trunc('year', pa.scored_at) AS season,
  count(*) AS events_predicted,
  sum(CASE WHEN pa.top_pick_correct THEN 1 ELSE 0 END) AS top_pick_wins,
  sum(pa.picks_in_top_3) AS total_top_3,
  sum(pa.picks_in_top_5) AS total_top_5,
  round(avg(CASE pa.accuracy_grade
    WHEN 'excellent' THEN 4 WHEN 'good' THEN 3 WHEN 'mixed' THEN 2 ELSE 1 END), 2) AS avg_grade_score
FROM prediction_accuracy pa
GROUP BY pa.domain, pa.mode, date_trunc('year', pa.scored_at);

CREATE OR REPLACE VIEW v_domain_summary AS
SELECT
  d.domain,
  count(*) FILTER (WHERE e.status = 'scheduled') AS upcoming_count,
  count(*) FILTER (WHERE e.status = 'resolved') AS resolved_count,
  (SELECT count(*) FROM prediction_accuracy pa WHERE pa.domain = d.domain) AS scored_count,
  (SELECT count(*) FROM prediction_accuracy pa WHERE pa.domain = d.domain AND pa.top_pick_correct) AS top_pick_wins
FROM (SELECT DISTINCT domain FROM events) d
LEFT JOIN events e ON e.domain = d.domain
GROUP BY d.domain;

GRANT SELECT ON v_domain_pick_record TO anon, authenticated;
GRANT SELECT ON v_domain_summary     TO anon, authenticated;

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
