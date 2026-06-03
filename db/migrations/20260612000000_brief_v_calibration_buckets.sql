-- Brief V: calibration buckets + live headline stat.
--
-- Aggregates resolved predictions from prediction_accuracy into per-domain,
-- per-bucket calibration metrics. Refreshed every 6 hours by pg_cron.
-- get_calibration_headline() is read by /how-it-works on every page render.

-- ============================================================
-- 1. calibration_buckets table
-- ============================================================
CREATE TABLE calibration_buckets (
  domain                text NOT NULL,
  bucket_min            int  NOT NULL CHECK (bucket_min IN (0,10,20,30,40,50,60,70,80,90)),
  bucket_max            int  NOT NULL CHECK (bucket_max IN (10,20,30,40,50,60,70,80,90,100)),
  n_predictions         int  NOT NULL DEFAULT 0,
  n_resolved            int  NOT NULL DEFAULT 0,
  n_correct             int  NOT NULL DEFAULT 0,
  realised_rate         numeric,
  calibration_error_pp  numeric,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, bucket_min, bucket_max),
  CHECK (bucket_max = bucket_min + 10),
  CHECK (n_resolved <= n_predictions),
  CHECK (n_correct  <= n_resolved)
);

CREATE INDEX idx_calibration_buckets_domain ON calibration_buckets(domain);

GRANT SELECT ON calibration_buckets TO anon, authenticated;
GRANT ALL    ON calibration_buckets TO service_role;

ALTER TABLE calibration_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calibration_buckets_public_read"
  ON calibration_buckets FOR SELECT USING (true);

COMMENT ON TABLE calibration_buckets IS 'Per-domain, per-probability-bucket calibration aggregates. Refreshed every 6 hours by cron. Powers /how-it-works headline stat.';

-- ============================================================
-- 2. Aggregation function: refresh_calibration_buckets()
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_calibration_buckets()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started_at timestamptz := clock_timestamp();
  v_rows int;
BEGIN
  DELETE FROM calibration_buckets;

  WITH scored AS (
    SELECT
      pa.domain,
      ((p.ranked_outcomes -> 0 ->> 'probability')::numeric) AS top_pick_prob,
      pa.top_pick_correct
    FROM prediction_accuracy pa
    JOIN predictions p ON p.id = pa.prediction_id
    WHERE pa.top_pick_correct IS NOT NULL
      AND p.ranked_outcomes IS NOT NULL
      AND jsonb_array_length(p.ranked_outcomes) > 0
      AND (p.ranked_outcomes -> 0 ->> 'probability') IS NOT NULL
  ),
  bucketed AS (
    SELECT
      domain,
      (LEAST(FLOOR(top_pick_prob * 10)::int, 9) * 10) AS bucket_min,
      top_pick_correct
    FROM scored
    WHERE top_pick_prob >= 0 AND top_pick_prob <= 1
  ),
  aggregated AS (
    SELECT
      domain,
      bucket_min,
      bucket_min + 10                                   AS bucket_max,
      COUNT(*)::int                                     AS n_predictions,
      COUNT(*)::int                                     AS n_resolved,
      SUM(CASE WHEN top_pick_correct THEN 1 ELSE 0 END)::int AS n_correct,
      (SUM(CASE WHEN top_pick_correct THEN 1 ELSE 0 END)::numeric
        / COUNT(*)::numeric * 100)                      AS realised_rate,
      ABS(
        (bucket_min + 5)::numeric
        - (SUM(CASE WHEN top_pick_correct THEN 1 ELSE 0 END)::numeric
            / COUNT(*)::numeric * 100)
      )                                                 AS calibration_error_pp
    FROM bucketed
    GROUP BY domain, bucket_min
  )
  INSERT INTO calibration_buckets (
    domain, bucket_min, bucket_max,
    n_predictions, n_resolved, n_correct,
    realised_rate, calibration_error_pp, updated_at
  )
  SELECT
    domain, bucket_min, bucket_max,
    n_predictions, n_resolved, n_correct,
    realised_rate, calibration_error_pp, now()
  FROM aggregated;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'refresh_calibration_buckets: % rows in % ms',
    v_rows,
    extract(milliseconds from clock_timestamp() - v_started_at);
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_calibration_buckets() TO service_role;

COMMENT ON FUNCTION refresh_calibration_buckets IS 'Recomputes calibration_buckets from prediction_accuracy. Idempotent. Called by cron every 6h and on-demand from edge functions if needed.';

-- ============================================================
-- 3. Headline RPC: get_calibration_headline()
-- ============================================================
CREATE OR REPLACE FUNCTION get_calibration_headline()
RETURNS TABLE (
  n_resolved                  int,
  avg_calibration_error_pp    numeric,
  computed_at                 timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COALESCE(SUM(n_resolved), 0)::int AS n_resolved,
    CASE
      WHEN COALESCE(SUM(n_resolved), 0) > 0 THEN
        ROUND(
          (SUM(calibration_error_pp * n_resolved) / SUM(n_resolved))::numeric,
          1
        )
      ELSE NULL
    END                                AS avg_calibration_error_pp,
    COALESCE(MAX(updated_at), now())   AS computed_at
  FROM calibration_buckets
  WHERE n_resolved > 0;
$$;

GRANT EXECUTE ON FUNCTION get_calibration_headline() TO anon, authenticated, service_role;

COMMENT ON FUNCTION get_calibration_headline IS 'Returns a single row of the global calibration headline. Read by /how-it-works on every page render.';

-- ============================================================
-- 4. Cron registration: refresh every 6 hours
-- ============================================================
SELECT cron.schedule(
  'refresh-calibration-buckets',
  '0 */6 * * *',
  $$SELECT refresh_calibration_buckets();$$
);

-- ============================================================
-- 5. Populate immediately
-- ============================================================
SELECT refresh_calibration_buckets();
