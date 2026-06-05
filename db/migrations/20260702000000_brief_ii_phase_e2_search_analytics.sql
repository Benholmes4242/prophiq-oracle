-- Brief II Phase E.2.1 - Search analytics
-- Purpose-built table for query analytics, written best-effort alongside
-- submission_rate_limits. Captures domain/result/match context that
-- submit-question already knows at runtime; no per-query embedding (hot path).

CREATE TABLE IF NOT EXISTS public.search_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  fingerprint text,
  question text NOT NULL,
  question_normalized text NOT NULL,
  domain text,
  result_type text NOT NULL CHECK (result_type IN ('matched','generated','rejected','failed')),
  matched_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_queries_created    ON public.search_queries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_queries_result     ON public.search_queries(result_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_queries_normalized ON public.search_queries(question_normalized);
CREATE INDEX IF NOT EXISTS idx_search_queries_domain     ON public.search_queries(domain, created_at DESC);

GRANT SELECT ON public.search_queries TO authenticated;
GRANT ALL    ON public.search_queries TO service_role;

ALTER TABLE public.search_queries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS search_queries_admin_read ON public.search_queries;
CREATE POLICY search_queries_admin_read ON public.search_queries
  FOR SELECT TO authenticated
  USING (public.is_admin());
-- No INSERT policy: service-role writes only (the edge function).

-- ---------------------------------------------------------------
-- Read RPCs (admin-only via is_admin())
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_search_top_queries(
  p_days int DEFAULT 7,
  p_limit int DEFAULT 100
) RETURNS TABLE (
  question_normalized text,
  sample_question text,
  hits bigint,
  matched bigint,
  generated bigint,
  rejected bigint,
  failed bigint,
  domains text[]
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  RETURN QUERY
  SELECT
    sq.question_normalized::text,
    (array_agg(sq.question ORDER BY sq.created_at DESC))[1]::text AS sample_question,
    count(*)::bigint,
    count(*) FILTER (WHERE sq.result_type = 'matched')::bigint,
    count(*) FILTER (WHERE sq.result_type = 'generated')::bigint,
    count(*) FILTER (WHERE sq.result_type = 'rejected')::bigint,
    count(*) FILTER (WHERE sq.result_type = 'failed')::bigint,
    array_remove(array_agg(DISTINCT sq.domain), NULL)::text[]
  FROM public.search_queries sq
  WHERE sq.created_at >= now() - make_interval(days => p_days)
  GROUP BY sq.question_normalized
  ORDER BY count(*) DESC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_search_top_queries(int,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_search_coverage_gaps(
  p_days int DEFAULT 7,
  p_limit int DEFAULT 50
) RETURNS TABLE (
  question_normalized text,
  sample_question text,
  hits bigint,
  last_seen timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  RETURN QUERY
  SELECT
    sq.question_normalized::text,
    (array_agg(sq.question ORDER BY sq.created_at DESC))[1]::text,
    count(*)::bigint,
    max(sq.created_at)
  FROM public.search_queries sq
  WHERE sq.created_at >= now() - make_interval(days => p_days)
    AND sq.result_type IN ('rejected','failed')
  GROUP BY sq.question_normalized
  ORDER BY count(*) DESC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_search_coverage_gaps(int,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_search_summary(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  SELECT jsonb_build_object(
    'total', (
      SELECT count(*) FROM public.search_queries
      WHERE created_at >= now() - make_interval(days => p_days)
    ),
    'by_result', (
      SELECT jsonb_object_agg(result_type, c) FROM (
        SELECT result_type, count(*) c FROM public.search_queries
        WHERE created_at >= now() - make_interval(days => p_days)
        GROUP BY result_type
      ) t
    ),
    'by_domain', (
      SELECT jsonb_object_agg(COALESCE(domain,'unclassified'), c) FROM (
        SELECT domain, count(*) c FROM public.search_queries
        WHERE created_at >= now() - make_interval(days => p_days)
        GROUP BY domain
      ) t
    ),
    'conversion_rate', (
      SELECT ROUND(
        count(*) FILTER (WHERE result_type IN ('matched','generated'))::numeric
        / GREATEST(count(*),1)::numeric,
        4
      )
      FROM public.search_queries
      WHERE created_at >= now() - make_interval(days => p_days)
    )
  ) INTO v;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_search_summary(int) TO authenticated;
