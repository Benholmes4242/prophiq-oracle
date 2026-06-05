-- Brief II Phase D - D.3: LLM cost tracking (hot path).
--
-- Tables:
--   * llm_pricing       — per-model price snapshot (cents per 1M tokens)
--   * llm_cost_events   — one row per LLM call, written best-effort by
--                         generate-prediction AFTER the prediction insert.
--                         The hot path never depends on these inserts.
--
-- A BEFORE INSERT trigger fills est_cost_minor from llm_pricing at write
-- time so future price changes don't rewrite historical costs.
--
-- All admin RPCs: SECURITY DEFINER, is_admin() guarded, search_path = public,
-- ::text casts in RETURNS TABLE.

-- ============================================================
-- llm_pricing
-- ============================================================
CREATE TABLE IF NOT EXISTS public.llm_pricing (
  model                       text PRIMARY KEY,
  input_per_million_minor     numeric NOT NULL,
  output_per_million_minor    numeric NOT NULL,
  currency                    text NOT NULL DEFAULT 'USD',
  effective_from              timestamptz NOT NULL DEFAULT now(),
  notes                       text
);

GRANT SELECT ON public.llm_pricing TO authenticated;
GRANT ALL    ON public.llm_pricing TO service_role;

ALTER TABLE public.llm_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY llm_pricing_admin_read ON public.llm_pricing
  FOR SELECT TO authenticated USING (public.is_admin());

-- Seed: published list prices (cents per 1M tokens) as of 2026-06.
-- Update via UPDATE statements (insert-tool migration), not via fresh migration.
INSERT INTO public.llm_pricing (model, input_per_million_minor, output_per_million_minor, currency, notes)
VALUES
  ('claude', 300,  1500, 'USD', 'claude-sonnet-4-5: $3.00 in / $15.00 out per 1M'),
  ('gpt',    15,   60,   'USD', 'gpt-4o-mini: $0.15 in / $0.60 out per 1M'),
  ('gemini', 7.5,  30,   'USD', 'gemini-2.5-flash: $0.075 in / $0.30 out per 1M')
ON CONFLICT (model) DO NOTHING;

-- ============================================================
-- llm_cost_events
-- ============================================================
CREATE TABLE IF NOT EXISTS public.llm_cost_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id   uuid REFERENCES public.predictions(id) ON DELETE SET NULL,
  event_id        uuid REFERENCES public.events(id)      ON DELETE SET NULL,
  domain          text,
  model           text NOT NULL,
  input_tokens    int,
  output_tokens   int,
  latency_ms      int,
  est_cost_minor  numeric,
  currency        text NOT NULL DEFAULT 'USD',
  had_error       boolean NOT NULL DEFAULT false,
  error_message   text,
  called_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_cost_events_called_at
  ON public.llm_cost_events(called_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_cost_events_model_called
  ON public.llm_cost_events(model, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_cost_events_domain_called
  ON public.llm_cost_events(domain, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_cost_events_prediction
  ON public.llm_cost_events(prediction_id);

GRANT SELECT, INSERT ON public.llm_cost_events TO authenticated;
GRANT ALL ON public.llm_cost_events TO service_role;

ALTER TABLE public.llm_cost_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY llm_cost_events_admin_read ON public.llm_cost_events
  FOR SELECT TO authenticated USING (public.is_admin());
-- Writes happen via service_role from the edge function; no INSERT policy
-- for authenticated callers.

-- ============================================================
-- Trigger: compute est_cost_minor from llm_pricing on insert
-- ============================================================
CREATE OR REPLACE FUNCTION public.llm_cost_events_fill_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in_price  numeric;
  v_out_price numeric;
  v_currency  text;
BEGIN
  IF NEW.est_cost_minor IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT input_per_million_minor, output_per_million_minor, currency
    INTO v_in_price, v_out_price, v_currency
  FROM public.llm_pricing
  WHERE model = NEW.model;

  IF v_in_price IS NULL THEN
    -- Unknown model: leave cost NULL so it's visible in dashboards.
    RETURN NEW;
  END IF;

  NEW.est_cost_minor :=
      (COALESCE(NEW.input_tokens, 0)::numeric  * v_in_price  / 1000000.0)
    + (COALESCE(NEW.output_tokens, 0)::numeric * v_out_price / 1000000.0);
  IF NEW.currency IS NULL OR NEW.currency = '' THEN
    NEW.currency := v_currency;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_llm_cost_events_fill_cost ON public.llm_cost_events;
CREATE TRIGGER trg_llm_cost_events_fill_cost
  BEFORE INSERT ON public.llm_cost_events
  FOR EACH ROW
  EXECUTE FUNCTION public.llm_cost_events_fill_cost();

-- ============================================================
-- admin_cost_summary: per-model totals over a window
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_cost_summary(
  p_since  timestamptz DEFAULT (now() - interval '30 days'),
  p_until  timestamptz DEFAULT now(),
  p_domain text DEFAULT NULL
) RETURNS TABLE (
  model            text,
  n_calls          int,
  n_errors         int,
  total_input_tk   bigint,
  total_output_tk  bigint,
  total_cost_minor numeric,
  avg_latency_ms   numeric,
  p95_latency_ms   numeric,
  currency         text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    c.model::text,
    COUNT(*)::int                                                  AS n_calls,
    SUM(CASE WHEN c.had_error THEN 1 ELSE 0 END)::int              AS n_errors,
    COALESCE(SUM(c.input_tokens), 0)::bigint                       AS total_input_tk,
    COALESCE(SUM(c.output_tokens), 0)::bigint                      AS total_output_tk,
    COALESCE(SUM(c.est_cost_minor), 0)::numeric                    AS total_cost_minor,
    ROUND(AVG(c.latency_ms)::numeric, 1)                           AS avg_latency_ms,
    ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY c.latency_ms)::numeric, 1) AS p95_latency_ms,
    MAX(c.currency)::text                                          AS currency
  FROM public.llm_cost_events c
  WHERE c.called_at >= p_since
    AND c.called_at <  p_until
    AND (p_domain IS NULL OR c.domain = p_domain)
  GROUP BY c.model
  ORDER BY c.model;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cost_summary(timestamptz, timestamptz, text) TO authenticated;

-- ============================================================
-- admin_cost_daily: time series for charting (per-day totals)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_cost_daily(
  p_since  timestamptz DEFAULT (now() - interval '30 days'),
  p_until  timestamptz DEFAULT now(),
  p_domain text DEFAULT NULL
) RETURNS TABLE (
  day              date,
  model            text,
  n_calls          int,
  total_cost_minor numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    date_trunc('day', c.called_at)::date                AS day,
    c.model::text                                       AS model,
    COUNT(*)::int                                       AS n_calls,
    COALESCE(SUM(c.est_cost_minor), 0)::numeric         AS total_cost_minor
  FROM public.llm_cost_events c
  WHERE c.called_at >= p_since
    AND c.called_at <  p_until
    AND (p_domain IS NULL OR c.domain = p_domain)
  GROUP BY 1, 2
  ORDER BY 1, 2;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cost_daily(timestamptz, timestamptz, text) TO authenticated;

-- ============================================================
-- admin_cost_recent: row-level audit
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_cost_recent(
  p_limit int DEFAULT 100
) RETURNS TABLE (
  id              uuid,
  called_at       timestamptz,
  model           text,
  domain          text,
  input_tokens    int,
  output_tokens   int,
  latency_ms      int,
  est_cost_minor  numeric,
  currency        text,
  had_error       boolean,
  error_message   text,
  prediction_id   uuid,
  event_id        uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.called_at,
    c.model::text,
    c.domain::text,
    c.input_tokens,
    c.output_tokens,
    c.latency_ms,
    c.est_cost_minor,
    c.currency::text,
    c.had_error,
    c.error_message::text,
    c.prediction_id,
    c.event_id
  FROM public.llm_cost_events c
  ORDER BY c.called_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cost_recent(int) TO authenticated;

-- ============================================================
-- admin_cost_pricing: list current pricing snapshot
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_cost_pricing()
RETURNS TABLE (
  model                     text,
  input_per_million_minor   numeric,
  output_per_million_minor  numeric,
  currency                  text,
  effective_from            timestamptz,
  notes                     text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    p.model::text,
    p.input_per_million_minor,
    p.output_per_million_minor,
    p.currency::text,
    p.effective_from,
    p.notes::text
  FROM public.llm_pricing p
  ORDER BY p.model;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cost_pricing() TO authenticated;

COMMENT ON TABLE public.llm_cost_events IS
  'Best-effort LLM call audit. Inserted post-prediction by generate-prediction behind LLM_COST_LOGGING_ENABLED flag. Insertion failures never block the hot path.';
