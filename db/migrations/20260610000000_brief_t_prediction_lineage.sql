-- Brief T: prediction lineage capture.
-- Two new tables: prediction_inputs (one row per prediction, captures the
-- resolved prompt + signals + time-of-call) and event_entities (named
-- entities extracted once per event, substrate for Brief U similarity).

CREATE TABLE prediction_inputs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id          uuid NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  event_id               uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  prompt_resolved        text NOT NULL,
  signals_used           text[] NOT NULL DEFAULT '{}',
  time_of_call           timestamptz NOT NULL DEFAULT now(),
  research_tokens_used   integer,
  llm_input_tokens_est   integer,
  prompt_version         text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_prediction_inputs_prediction
  ON prediction_inputs(prediction_id);
CREATE INDEX idx_prediction_inputs_event
  ON prediction_inputs(event_id);
CREATE INDEX idx_prediction_inputs_time_of_call
  ON prediction_inputs(time_of_call DESC);
CREATE INDEX idx_prediction_inputs_signals
  ON prediction_inputs USING gin (signals_used);

GRANT SELECT ON prediction_inputs TO anon, authenticated;
GRANT ALL ON prediction_inputs TO service_role;

ALTER TABLE prediction_inputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prediction_inputs_public_read"
  ON prediction_inputs FOR SELECT USING (true);

CREATE TABLE event_entities (
  event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  entity_value    text NOT NULL,
  entity_type     text NOT NULL
                    CHECK (entity_type IN
                      ('person','team','organization','event','place','date','other')),
  confidence      numeric,
  extracted_at    timestamptz NOT NULL DEFAULT now(),
  extractor       text NOT NULL DEFAULT 'claude-haiku-4-5',
  PRIMARY KEY (event_id, entity_value, entity_type)
);

CREATE INDEX idx_event_entities_value
  ON event_entities(lower(entity_value));
CREATE INDEX idx_event_entities_type
  ON event_entities(entity_type);
CREATE INDEX idx_event_entities_event
  ON event_entities(event_id);

GRANT SELECT ON event_entities TO anon, authenticated;
GRANT ALL ON event_entities TO service_role;

ALTER TABLE event_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_entities_public_read"
  ON event_entities FOR SELECT USING (true);
