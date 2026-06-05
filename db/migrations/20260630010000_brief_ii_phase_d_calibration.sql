-- Brief II Phase D - D.2: Calibration & resolution.
--
-- Adds admin resolution flow + read RPCs for calibration overview, per-LLM
-- accuracy, pending and recent resolutions.
--
-- Confirmed data shapes (from pre-flight):
--   * predictions.ranked_outcomes: jsonb array of
--       { outcome_id, outcome_label, rank, probability, ... }
--     where `probability` is on a 0-100 scale (hard-coded /100 below).
--   * predictions.model_results: jsonb array of
--       { model, ranked_outcome_ids: text[], error?, ... }
--     where ranked_outcome_ids[0] is the model's top pick.
--   * event_resolutions.outcome_rankings: jsonb array of { outcome_id, rank }.
--
-- All RPCs SECURITY DEFINER, is_admin() guarded, search_path = public.

-- ============================================================
-- admin_resolve_prediction
--   Records the winning outcome for an event, marks the event resolved,
--   and writes a minimal prediction_accuracy row for the current prediction.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_resolve_prediction(
  p_event_id uuid,
  p_winning_outcome_id uuid,
  p_source text DEFAULT 'admin_manual',
  p_resolution_context text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pred predictions%ROWTYPE;
  v_event events%ROWTYPE;
  v_outcome_belongs boolean;
  v_winner_label text;
  v_top_pick_id uuid;
  v_top3_ids uuid[];
  v_top_pick_correct boolean;
  v_winner_rank int;
  v_in_top3 int;
  v_before jsonb;
  v_audit uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event % not found', p_event_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_outcomes
    WHERE id = p_winning_outcome_id AND event_id = p_event_id
  ) INTO v_outcome_belongs;

  IF NOT v_outcome_belongs THEN
    RAISE EXCEPTION 'Outcome % does not belong to event %', p_winning_outcome_id, p_event_id;
  END IF;

  SELECT label INTO v_winner_label
  FROM public.event_outcomes WHERE id = p_winning_outcome_id;

  -- Snapshot existing resolution (if any) for audit trail.
  SELECT to_jsonb(er.*) INTO v_before
  FROM public.event_resolutions er
  WHERE er.event_id = p_event_id;

  INSERT INTO public.event_resolutions (
    event_id, outcome_rankings, source, resolution_context, resolved_at
  ) VALUES (
    p_event_id,
    jsonb_build_array(jsonb_build_object('outcome_id', p_winning_outcome_id, 'rank', 1)),
    COALESCE(p_source, 'admin_manual'),
    p_resolution_context,
    now()
  )
  ON CONFLICT (event_id) DO UPDATE
    SET outcome_rankings   = EXCLUDED.outcome_rankings,
        source             = EXCLUDED.source,
        resolution_context = EXCLUDED.resolution_context,
        resolved_at        = now();

  UPDATE public.events SET status = 'resolved', updated_at = now()
  WHERE id = p_event_id;

  -- Score the current prediction (if any).
  SELECT * INTO v_pred FROM public.predictions
  WHERE event_id = p_event_id AND is_current = true
  ORDER BY generated_at DESC LIMIT 1;

  IF v_pred.id IS NOT NULL THEN
    v_top_pick_id := NULLIF((v_pred.ranked_outcomes -> 0 ->> 'outcome_id'), '')::uuid;
    SELECT ARRAY(
      SELECT NULLIF((elem ->> 'outcome_id'), '')::uuid
      FROM jsonb_array_elements(v_pred.ranked_outcomes) WITH ORDINALITY t(elem, ord)
      WHERE t.ord <= 3
    ) INTO v_top3_ids;

    v_top_pick_correct := (v_top_pick_id = p_winning_outcome_id);
    v_in_top3 := CASE WHEN p_winning_outcome_id = ANY(v_top3_ids) THEN 1 ELSE 0 END;

    SELECT (t.ord)::int INTO v_winner_rank
    FROM jsonb_array_elements(v_pred.ranked_outcomes) WITH ORDINALITY t(elem, ord)
    WHERE NULLIF((elem ->> 'outcome_id'), '')::uuid = p_winning_outcome_id
    LIMIT 1;

    INSERT INTO public.prediction_accuracy (
      prediction_id, event_id, domain, mode, pick_results,
      top_pick_correct, picks_in_top_3, picks_in_top_5, picks_in_top_10,
      best_pick_actual_rank, prompt_version, consensus_method, scored_at
    ) VALUES (
      v_pred.id, p_event_id, v_event.domain, v_pred.mode,
      jsonb_build_object(
        'winning_outcome_id', p_winning_outcome_id,
        'winning_outcome_label', v_winner_label,
        'predicted_top', v_pred.ranked_outcomes
      ),
      v_top_pick_correct, v_in_top3, v_in_top3, v_in_top3,
      v_winner_rank,
      v_pred.prompt_version, v_pred.consensus_method, now()
    )
    ON CONFLICT (event_id, mode) DO UPDATE
      SET prediction_id         = EXCLUDED.prediction_id,
          pick_results          = EXCLUDED.pick_results,
          top_pick_correct      = EXCLUDED.top_pick_correct,
          picks_in_top_3        = EXCLUDED.picks_in_top_3,
          picks_in_top_5        = EXCLUDED.picks_in_top_5,
          picks_in_top_10       = EXCLUDED.picks_in_top_10,
          best_pick_actual_rank = EXCLUDED.best_pick_actual_rank,
          prompt_version        = EXCLUDED.prompt_version,
          consensus_method      = EXCLUDED.consensus_method,
          scored_at             = now();
  END IF;

  v_audit := public.log_admin_action(
    'event.resolve',
    'event',
    p_event_id,
    v_before,
    jsonb_build_object(
      'winning_outcome_id', p_winning_outcome_id,
      'winning_outcome_label', v_winner_label,
      'source', p_source
    ),
    jsonb_build_object('event_slug', v_event.slug, 'domain', v_event.domain)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', p_event_id,
    'winning_outcome_id', p_winning_outcome_id,
    'winning_outcome_label', v_winner_label,
    'top_pick_correct', v_top_pick_correct,
    'audit_id', v_audit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_resolve_prediction(uuid, uuid, text, text) TO authenticated;

-- ============================================================
-- admin_calibration_overview
--   Per-domain top-1 / top-3 accuracy + average Brier score over resolved
--   predictions. Brier is computed from the predicted top-N outcomes:
--     B = SUM over ranked_outcomes of ( (probability / 100) - y_i )^2
--   where y_i = 1 iff that outcome is the winner. probability is on
--   a 0-100 scale per pre-flight.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_calibration_overview(
  p_domain text DEFAULT NULL,
  p_since  timestamptz DEFAULT NULL
) RETURNS TABLE (
  domain           text,
  n_resolved       int,
  top1_accuracy    numeric,
  top3_accuracy    numeric,
  avg_brier        numeric,
  avg_top_prob     numeric,
  last_resolved_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      pa.domain::text                                  AS domain,
      pa.top_pick_correct,
      pa.picks_in_top_3,
      pa.scored_at,
      ((p.ranked_outcomes -> 0 ->> 'probability')::numeric / 100.0) AS top_prob,
      (
        SELECT COALESCE(SUM(
          (
            ((elem ->> 'probability')::numeric / 100.0)
            - CASE WHEN NULLIF((elem ->> 'outcome_id'), '')::uuid
                        = NULLIF((pa.pick_results ->> 'winning_outcome_id'), '')::uuid
                   THEN 1 ELSE 0 END
          ) ^ 2
        ), 0)
        FROM jsonb_array_elements(p.ranked_outcomes) elem
        WHERE (elem ->> 'probability') IS NOT NULL
      ) AS brier
    FROM public.prediction_accuracy pa
    JOIN public.predictions p ON p.id = pa.prediction_id
    WHERE pa.top_pick_correct IS NOT NULL
      AND (p_domain IS NULL OR pa.domain = p_domain)
      AND (p_since  IS NULL OR pa.scored_at >= p_since)
  )
  SELECT
    b.domain,
    COUNT(*)::int                                                AS n_resolved,
    ROUND(AVG(CASE WHEN b.top_pick_correct THEN 1 ELSE 0 END) * 100, 2) AS top1_accuracy,
    ROUND(AVG(CASE WHEN b.picks_in_top_3 > 0 THEN 1 ELSE 0 END) * 100, 2) AS top3_accuracy,
    ROUND(AVG(b.brier)::numeric, 4)                              AS avg_brier,
    ROUND(AVG(b.top_prob)::numeric * 100, 2)                     AS avg_top_prob,
    MAX(b.scored_at)                                             AS last_resolved_at
  FROM base b
  GROUP BY b.domain
  ORDER BY b.domain;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_calibration_overview(text, timestamptz) TO authenticated;

-- ============================================================
-- admin_per_llm_accuracy
--   For each model present in predictions.model_results, computes top-pick
--   accuracy and sample size across resolved predictions. Reads
--   model_results[i].ranked_outcome_ids[0] as that model's top pick.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_per_llm_accuracy(
  p_domain text DEFAULT NULL,
  p_since  timestamptz DEFAULT NULL
) RETURNS TABLE (
  model         text,
  n_resolved    int,
  n_with_pick   int,
  n_errors      int,
  top1_accuracy numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH per_model AS (
    SELECT
      (mr ->> 'model')::text AS model,
      NULLIF((mr -> 'ranked_outcome_ids' ->> 0), '')::uuid AS top_pick_id,
      (mr ->> 'error') IS NOT NULL AS had_error,
      NULLIF((pa.pick_results ->> 'winning_outcome_id'), '')::uuid AS winner_id
    FROM public.prediction_accuracy pa
    JOIN public.predictions p ON p.id = pa.prediction_id
    CROSS JOIN LATERAL jsonb_array_elements(p.model_results) mr
    WHERE pa.top_pick_correct IS NOT NULL
      AND (p_domain IS NULL OR pa.domain = p_domain)
      AND (p_since  IS NULL OR pa.scored_at >= p_since)
  )
  SELECT
    pm.model,
    COUNT(*)::int                                                       AS n_resolved,
    SUM(CASE WHEN pm.top_pick_id IS NOT NULL THEN 1 ELSE 0 END)::int    AS n_with_pick,
    SUM(CASE WHEN pm.had_error THEN 1 ELSE 0 END)::int                  AS n_errors,
    CASE
      WHEN SUM(CASE WHEN pm.top_pick_id IS NOT NULL THEN 1 ELSE 0 END) = 0 THEN NULL
      ELSE ROUND(
        SUM(CASE WHEN pm.top_pick_id IS NOT NULL AND pm.top_pick_id = pm.winner_id THEN 1 ELSE 0 END)::numeric
        / SUM(CASE WHEN pm.top_pick_id IS NOT NULL THEN 1 ELSE 0 END)::numeric * 100,
        2
      )
    END AS top1_accuracy
  FROM per_model pm
  WHERE pm.model IS NOT NULL
  GROUP BY pm.model
  ORDER BY pm.model;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_per_llm_accuracy(text, timestamptz) TO authenticated;

-- ============================================================
-- admin_pending_resolutions
--   Events whose resolves_at is in the past but which have no resolution
--   row yet (and aren't cancelled).
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_pending_resolutions(
  p_limit int DEFAULT 50
) RETURNS TABLE (
  event_id     uuid,
  slug         text,
  title        text,
  domain       text,
  resolves_at  timestamptz,
  has_current_prediction boolean
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
    e.id,
    e.slug::text,
    e.title::text,
    e.domain::text,
    e.resolves_at,
    EXISTS (
      SELECT 1 FROM public.predictions p
      WHERE p.event_id = e.id AND p.is_current = true
    ) AS has_current_prediction
  FROM public.events e
  LEFT JOIN public.event_resolutions er ON er.event_id = e.id
  WHERE e.status <> 'cancelled'
    AND e.resolves_at <= now()
    AND er.event_id IS NULL
    AND e.moderation_status = 'approved'
  ORDER BY e.resolves_at ASC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_pending_resolutions(int) TO authenticated;

-- ============================================================
-- admin_recent_resolutions
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_recent_resolutions(
  p_limit int DEFAULT 25
) RETURNS TABLE (
  event_id          uuid,
  slug              text,
  title             text,
  domain            text,
  resolved_at       timestamptz,
  source            text,
  winning_outcome_id uuid,
  winning_label     text,
  top_pick_correct  boolean
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
    e.id,
    e.slug::text,
    e.title::text,
    e.domain::text,
    er.resolved_at,
    er.source::text,
    NULLIF((er.outcome_rankings -> 0 ->> 'outcome_id'), '')::uuid AS winning_outcome_id,
    eo.label::text                                                AS winning_label,
    pa.top_pick_correct
  FROM public.event_resolutions er
  JOIN public.events e ON e.id = er.event_id
  LEFT JOIN public.event_outcomes eo
    ON eo.id = NULLIF((er.outcome_rankings -> 0 ->> 'outcome_id'), '')::uuid
  LEFT JOIN public.prediction_accuracy pa ON pa.event_id = e.id
  ORDER BY er.resolved_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_recent_resolutions(int) TO authenticated;

-- ============================================================
-- admin_event_outcomes
--   Helper read for the resolve modal: list outcomes for an event.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_event_outcomes(
  p_event_id uuid
) RETURNS TABLE (
  outcome_id uuid,
  label      text,
  external_id text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT eo.id, eo.label::text, eo.external_id::text
  FROM public.event_outcomes eo
  WHERE eo.event_id = p_event_id
  ORDER BY eo.label;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_event_outcomes(uuid) TO authenticated;
