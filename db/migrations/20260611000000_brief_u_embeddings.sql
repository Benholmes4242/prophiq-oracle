-- Brief U: embeddings + similarity search infrastructure.
--
-- Enables the pgvector extension, adds an embedding column to events,
-- creates an HNSW cosine index, and exposes find_similar_events() RPC.
-- Embeddings are populated lazily by generate-prediction on first call
-- for any event whose embedding is NULL.

-- ============================================================
-- 1. Enable pgvector extension
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 2. Embedding columns on events
-- ============================================================
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS embedding        vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_model  text,
  ADD COLUMN IF NOT EXISTS embedded_at      timestamptz;

COMMENT ON COLUMN events.embedding        IS 'OpenAI text-embedding-3-small vector (1536 dims). NULL until generate-prediction lazy-fills it.';
COMMENT ON COLUMN events.embedding_model  IS 'Embedder identifier, e.g. "text-embedding-3-small". For tracking embedder evolution.';
COMMENT ON COLUMN events.embedded_at      IS 'When the embedding was generated. Used for re-embedding sweeps if model is upgraded.';

-- ============================================================
-- 3. HNSW index on embedding (cosine distance)
-- ============================================================
CREATE INDEX IF NOT EXISTS events_embedding_hnsw_idx
  ON events
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================
-- 4. RPC: find_similar_events
-- ============================================================
CREATE OR REPLACE FUNCTION find_similar_events(
  p_query_event_id        uuid,
  p_limit                 int     DEFAULT 10,
  p_min_similarity        float   DEFAULT 0.70,
  p_domain_filter         text    DEFAULT NULL,
  p_exclude_unresolved    boolean DEFAULT false
)
RETURNS TABLE (
  event_id       uuid,
  similarity     float,
  domain         text,
  title          text,
  question       text,
  status         text,
  starts_at      timestamptz,
  resolves_at    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_query_embedding vector(1536);
BEGIN
  SELECT e.embedding INTO v_query_embedding
  FROM events e
  WHERE e.id = p_query_event_id;

  IF v_query_embedding IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    (1 - (e.embedding <=> v_query_embedding))::float AS similarity,
    e.domain,
    e.title,
    e.question,
    e.status,
    e.starts_at,
    e.resolves_at
  FROM events e
  WHERE e.id <> p_query_event_id
    AND e.embedding IS NOT NULL
    AND (p_domain_filter IS NULL OR e.domain = p_domain_filter)
    AND (NOT p_exclude_unresolved OR e.status = 'resolved')
    AND (1 - (e.embedding <=> v_query_embedding)) >= p_min_similarity
  ORDER BY e.embedding <=> v_query_embedding ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION find_similar_events(uuid, int, float, text, boolean)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION find_similar_events(uuid, int, float, text, boolean)
  IS 'Returns events most semantically similar to the query event. Pure embedding cosine similarity (no entity overlap blending in v1). Brief W consumes this for prior context assembly.';
