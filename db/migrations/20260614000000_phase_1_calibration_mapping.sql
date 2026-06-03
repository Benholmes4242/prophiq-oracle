-- Phase 1: Post-hoc calibration mapping.
--
-- Adds the calibration_curves table (PAV-fitted monotonic mapping per domain),
-- the columns on prediction_inputs + predictions that track the raw / curve
-- version, the refresh function, the runtime lookup function, and the cron
-- registration. Also updates refresh_calibration_buckets() to read raw probs
-- so calibration curves never get fit on already-calibrated data.

-- ============================================================
-- 1. calibration_curves table
-- ============================================================
CREATE TABLE calibration_curves (
  domain                text NOT NULL,
  raw_prob_pct          numeric NOT NULL CHECK (raw_prob_pct >= 0 AND raw_prob_pct <= 100),
  calibrated_prob_pct   numeric NOT NULL CHECK (calibrated_prob_pct >= 0 AND calibrated_prob_pct <= 100),
  source_n_resolved     integer NOT NULL DEFAULT 0,
  is_boundary           boolean NOT NULL DEFAULT false,
  version               text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, raw_prob_pct, version)
);

CREATE INDEX idx_calibration_curves_domain_version
  ON calibration_curves(domain, version DESC);

GRANT SELECT ON calibration_curves TO anon, authenticated;
GRANT ALL    ON calibration_curves TO service_role;

ALTER TABLE calibration_curves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calibration_curves_public_read"
  ON calibration_curves FOR SELECT USING (true);

COMMENT ON TABLE calibration_curves IS 'Piecewise-linear monotonic calibration curve breakpoints per domain. Refreshed weekly by cron. Used at runtime by generate-prediction to map raw consensus probabilities onto calibrated equivalents.';

-- ============================================================
-- 2. Columns on prediction_inputs + predictions
-- ============================================================
ALTER TABLE prediction_inputs
  ADD COLUMN IF NOT EXISTS top_pick_prob_raw numeric;

COMMENT ON COLUMN prediction_inputs.top_pick_prob_raw IS 'Top pick probability BEFORE calibration mapping. Used by refresh_calibration_buckets() to fit the next curve. Old rows from before Brief X are NULL; the bucket refresh falls back to ranked_outcomes[0].probability for those.';

ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS calibration_curve_version text;

COMMENT ON COLUMN predictions.calibration_curve_version IS 'Version string of the calibration_curves snapshot applied. NULL or empty means no calibration was applied.';

-- ============================================================
-- 3. refresh_calibration_curves() - learns + writes the curve
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_calibration_curves()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version            text := to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_sample_threshold   integer := 20;
  rec                  record;
  v_domain             text;
  v_blended            numeric[];
  v_midpoints          numeric[];
  v_weights            integer[];
  v_n                  int;
  i                    int;
  pooled_y             numeric;
  pooled_w             integer;
  changed              boolean;
BEGIN
  FOR v_domain IN
    SELECT DISTINCT domain FROM calibration_buckets WHERE n_resolved > 0
  LOOP
    v_midpoints := ARRAY[]::numeric[];
    v_blended := ARRAY[]::numeric[];
    v_weights := ARRAY[]::integer[];

    FOR rec IN
      SELECT
        bucket_min + 5 AS midpoint,
        realised_rate,
        n_resolved
      FROM calibration_buckets
      WHERE domain = v_domain AND n_resolved > 0
      ORDER BY bucket_min
    LOOP
      v_midpoints := v_midpoints || rec.midpoint;
      DECLARE
        v_confidence numeric := LEAST(rec.n_resolved::numeric / v_sample_threshold, 1.0);
        v_blended_y  numeric := v_confidence * rec.realised_rate + (1 - v_confidence) * rec.midpoint;
      BEGIN
        v_blended := v_blended || v_blended_y;
      END;
      v_weights := v_weights || rec.n_resolved;
    END LOOP;

    v_n := array_length(v_midpoints, 1);
    IF v_n IS NULL OR v_n = 0 THEN
      CONTINUE;
    END IF;

    -- Pool-Adjacent-Violators: repeat passes until no changes
    LOOP
      changed := false;
      i := 1;
      WHILE i < v_n LOOP
        IF v_blended[i] > v_blended[i+1] THEN
          pooled_y := (v_blended[i] * v_weights[i] + v_blended[i+1] * v_weights[i+1])
                      / (v_weights[i] + v_weights[i+1]);
          pooled_w := v_weights[i] + v_weights[i+1];
          v_blended[i]   := pooled_y;
          v_blended[i+1] := pooled_y;
          v_weights[i]   := pooled_w;
          v_weights[i+1] := pooled_w;
          changed := true;
        END IF;
        i := i + 1;
      END LOOP;
      EXIT WHEN NOT changed;
    END LOOP;

    INSERT INTO calibration_curves
      (domain, raw_prob_pct, calibrated_prob_pct, source_n_resolved, is_boundary, version)
    VALUES (v_domain, 0, 0, 0, true, v_version);

    FOR i IN 1..v_n LOOP
      INSERT INTO calibration_curves
        (domain, raw_prob_pct, calibrated_prob_pct, source_n_resolved, is_boundary, version)
      VALUES (v_domain, v_midpoints[i], v_blended[i], v_weights[i], false, v_version);
    END LOOP;

    INSERT INTO calibration_curves
      (domain, raw_prob_pct, calibrated_prob_pct, source_n_resolved, is_boundary, version)
    VALUES (v_domain, 100, 100, 0, true, v_version);

    RAISE NOTICE 'refresh_calibration_curves: domain=% wrote % breakpoints version=%',
      v_domain, v_n + 2, v_version;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_calibration_curves() TO service_role;

COMMENT ON FUNCTION refresh_calibration_curves IS 'Recomputes per-domain calibration curves from calibration_buckets using confidence-blending + PAV. Writes a new version of breakpoints to calibration_curves. Called weekly by cron.';

-- ============================================================
-- 4. apply_calibration_curve() - runtime lookup function
-- ============================================================
CREATE OR REPLACE FUNCTION apply_calibration_curve(
  p_domain    text,
  p_raw_prob  numeric
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_raw_pct       numeric;
  v_latest_ver    text;
  v_x_lo          numeric;
  v_y_lo          numeric;
  v_x_hi          numeric;
  v_y_hi          numeric;
  v_t             numeric;
  v_result_pct    numeric;
  v_input_was_pct boolean;
BEGIN
  v_input_was_pct := p_raw_prob > 1;
  v_raw_pct := CASE WHEN v_input_was_pct THEN p_raw_prob ELSE p_raw_prob * 100 END;

  IF v_raw_pct < 0 THEN v_raw_pct := 0; END IF;
  IF v_raw_pct > 100 THEN v_raw_pct := 100; END IF;

  SELECT MAX(version) INTO v_latest_ver
  FROM calibration_curves
  WHERE domain = p_domain;

  IF v_latest_ver IS NULL THEN
    RETURN p_raw_prob;
  END IF;

  SELECT raw_prob_pct, calibrated_prob_pct INTO v_x_lo, v_y_lo
  FROM calibration_curves
  WHERE domain = p_domain AND version = v_latest_ver AND raw_prob_pct <= v_raw_pct
  ORDER BY raw_prob_pct DESC
  LIMIT 1;

  SELECT raw_prob_pct, calibrated_prob_pct INTO v_x_hi, v_y_hi
  FROM calibration_curves
  WHERE domain = p_domain AND version = v_latest_ver AND raw_prob_pct >= v_raw_pct
  ORDER BY raw_prob_pct ASC
  LIMIT 1;

  IF v_x_lo IS NULL OR v_x_hi IS NULL THEN
    RETURN p_raw_prob;
  END IF;

  IF v_x_hi = v_x_lo THEN
    v_result_pct := v_y_lo;
  ELSE
    v_t := (v_raw_pct - v_x_lo) / (v_x_hi - v_x_lo);
    v_result_pct := v_y_lo + v_t * (v_y_hi - v_y_lo);
  END IF;

  RETURN CASE WHEN v_input_was_pct THEN v_result_pct ELSE v_result_pct / 100 END;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_calibration_curve(text, numeric)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION apply_calibration_curve IS 'Runtime lookup: maps a raw probability through the latest calibration curve for the domain. Accepts 0..1 floats or 0..100 percentages; returns in the same units. Identity passthrough if no curve exists.';

-- ============================================================
-- 5. Updated refresh_calibration_buckets() - uses raw probs
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
      COALESCE(
        pi.top_pick_prob_raw,
        ((p.ranked_outcomes -> 0 ->> 'probability')::numeric)
      ) AS top_pick_prob,
      pa.top_pick_correct
    FROM prediction_accuracy pa
    JOIN predictions p ON p.id = pa.prediction_id
    LEFT JOIN prediction_inputs pi ON pi.prediction_id = p.id
    WHERE pa.top_pick_correct IS NOT NULL
      AND p.ranked_outcomes IS NOT NULL
      AND jsonb_array_length(p.ranked_outcomes) > 0
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
      bucket_min + 10 AS bucket_max,
      COUNT(*)::int AS n_predictions,
      COUNT(*)::int AS n_resolved,
      SUM(CASE WHEN top_pick_correct THEN 1 ELSE 0 END)::int AS n_correct,
      (SUM(CASE WHEN top_pick_correct THEN 1 ELSE 0 END)::numeric
        / COUNT(*)::numeric * 100) AS realised_rate,
      ABS(
        (bucket_min + 5)::numeric
        - (SUM(CASE WHEN top_pick_correct THEN 1 ELSE 0 END)::numeric
            / COUNT(*)::numeric * 100)
      ) AS calibration_error_pp
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
  RAISE NOTICE 'refresh_calibration_buckets: % rows in % ms (using raw probs)',
    v_rows,
    extract(milliseconds from clock_timestamp() - v_started_at);
END;
$$;

-- ============================================================
-- 6. Cron registration: refresh curves weekly (Sun 02:00 UTC)
-- ============================================================
SELECT cron.schedule(
  'refresh-calibration-curves',
  '0 2 * * 0',
  $$SELECT refresh_calibration_curves();$$
);

-- ============================================================
-- 7. Populate immediately
-- ============================================================
SELECT refresh_calibration_buckets();
SELECT refresh_calibration_curves();
