-- Brief W: prior context from similar past forecasts.
--
-- Adds the column to prediction_inputs that tracks which priors were used
-- for each new forecast, and the RPC that assembles the prior context
-- block in one SQL call (similarity + prediction + resolution joined).

-- ============================================================
-- 1. prior_predictions_used column on prediction_inputs
-- ============================================================
ALTER TABLE prediction_inputs
  ADD COLUMN IF NOT EXISTS prior_predictions_used jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN prediction_inputs.prior_predictions_used IS 'JSONB array of similar past forecasts fed to the LLMs as prior context. Empty array means no priors were used (either feature disabled, no similar events found, or below threshold).';

-- ============================================================
-- 2. RPC: get_prior_context_for_event
-- ============================================================
CREATE OR REPLACE FUNCTION get_prior_context_for_event(
  p_query_event_id     uuid,
  p_limit              int   DEFAULT 5,
  p_min_similarity     float DEFAULT 0.75
)
RETURNS TABLE (
  prediction_id        uuid,
  event_id             uuid,
  similarity           float,
  question             text,
  top_pick_label       text,
  top_pick_prob        numeric,
  was_correct          boolean,
  resolved_at          timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_query_embedding vector(1536);
  v_query_domain    text;
BEGIN
  SELECT e.embedding, e.domain
  INTO v_query_embedding, v_query_domain
  FROM events e
  WHERE e.id = p_query_event_id;

  IF v_query_embedding IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id                                                  AS prediction_id,
    e.id                                                  AS event_id,
    (1 - (e.embedding <=> v_query_embedding))::float      AS similarity,
    e.question,
    (p.ranked_outcomes -> 0 ->> 'outcome_label')::text    AS top_pick_label,
    ((p.ranked_outcomes -> 0 ->> 'probability')::numeric) AS top_pick_prob,
    pa.top_pick_correct                                   AS was_correct,
    er.resolved_at
  FROM events e
  JOIN predictions p           ON p.event_id  = e.id AND p.is_current = true
  JOIN prediction_accuracy pa  ON pa.prediction_id = p.id
  JOIN event_resolutions er    ON er.event_id = e.id
  WHERE e.id <> p_query_event_id
    AND e.embedding IS NOT NULL
    AND e.domain = v_query_domain
    AND pa.top_pick_correct IS NOT NULL
    AND p.ranked_outcomes IS NOT NULL
    AND jsonb_array_length(p.ranked_outcomes) > 0
    AND (1 - (e.embedding <=> v_query_embedding)) >= p_min_similarity
  ORDER BY e.embedding <=> v_query_embedding ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_prior_context_for_event(uuid, int, float)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION get_prior_context_for_event IS 'Returns similar resolved past forecasts ready to format as prior context for a new LLM prompt. Joins similarity search with prediction + resolution data in one SQL call. Brief W consumes this in generate-prediction.';
