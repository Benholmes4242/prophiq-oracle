-- Brief II Phase E.1 - Events admin RPCs.
-- All SECURITY DEFINER, role-gated where mutating, audit-logged.
-- All RETURNS TABLE rows cast varchar/enum -> text (42804 prevention).
-- Reuses admin_approve_question / admin_reject_question / admin_resolve_prediction
-- from earlier phases - they are NOT redefined here.

-- ============================================================
-- admin_list_events
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_events(
  p_domain text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_moderation_status text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_has_prediction boolean DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  slug text,
  title text,
  domain text,
  status text,
  mode text,
  source text,
  moderation_status text,
  starts_at timestamptz,
  resolves_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz,
  has_current_prediction boolean,
  prediction_count int,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN QUERY
  WITH pred_stats AS (
    SELECT
      p.event_id,
      COUNT(*)::int AS pred_count,
      BOOL_OR(p.is_current) AS has_current
    FROM public.predictions p
    GROUP BY p.event_id
  ),
  base AS (
    SELECT
      e.id, e.slug, e.title, e.domain, e.status, e.mode, e.source,
      e.moderation_status, e.starts_at, e.resolves_at, e.submitted_at, e.created_at,
      COALESCE(ps.has_current, false) AS has_current,
      COALESCE(ps.pred_count, 0)      AS pred_count
    FROM public.events e
    LEFT JOIN pred_stats ps ON ps.event_id = e.id
    WHERE (p_domain            IS NULL OR e.domain            = p_domain)
      AND (p_status            IS NULL OR e.status::text      = p_status)
      AND (p_moderation_status IS NULL OR e.moderation_status::text = p_moderation_status)
      AND (p_source            IS NULL OR e.source::text      = p_source)
      AND (p_has_prediction    IS NULL OR COALESCE(ps.has_current, false) = p_has_prediction)
      AND (p_search            IS NULL OR e.title ILIKE '%' || p_search || '%')
  ), counted AS (
    SELECT b.*, COUNT(*) OVER() AS total FROM base b
  )
  SELECT
    c.id, c.slug::text, c.title::text, c.domain::text, c.status::text, c.mode::text, c.source::text,
    c.moderation_status::text, c.starts_at, c.resolves_at, c.submitted_at, c.created_at,
    c.has_current, c.pred_count, c.total
  FROM counted c
  ORDER BY c.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_events(text,text,text,text,boolean,text,int,int) TO authenticated;

-- ============================================================
-- admin_get_event_detail
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_event_detail(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_event jsonb;
  v_outcomes jsonb;
  v_prediction jsonb;
  v_children jsonb;
  v_resolution jsonb;
  v_submitter jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT to_jsonb(e) - 'embedding' INTO v_event
  FROM (
    SELECT
      e.id, e.slug::text AS slug, e.title::text AS title, e.description, e.question::text AS question,
      e.domain::text AS domain, e.status::text AS status, e.mode::text AS mode,
      e.source::text AS source, e.moderation_status::text AS moderation_status,
      e.moderation_reason, e.moderation_metadata, e.metadata,
      e.starts_at, e.resolves_at, e.submitted_at, e.submitted_by_fingerprint,
      e.submitted_by_user_id, e.parent_event_id, e.created_at, e.updated_at
    FROM public.events e WHERE e.id = p_event_id
  ) e;

  IF v_event IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'external_id', o.external_id::text,
    'label', o.label::text,
    'metadata', o.metadata
  ) ORDER BY o.created_at), '[]'::jsonb)
  INTO v_outcomes
  FROM public.event_outcomes o WHERE o.event_id = p_event_id;

  SELECT to_jsonb(p) INTO v_prediction
  FROM (
    SELECT
      p.id, p.event_id, p.mode::text AS mode, p.ranked_outcomes, p.alternates,
      p.consensus_method, p.consensus_score, p.agreement_score, p.model_results,
      p.research_context, p.prompt_version, p.calibration_curve_version,
      p.generated_at, p.expires_at, p.is_current
    FROM public.predictions p
    WHERE p.event_id = p_event_id AND p.is_current = true
    ORDER BY p.generated_at DESC
    LIMIT 1
  ) p;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'slug', c.slug::text,
    'title', c.title::text,
    'status', c.status::text,
    'mode', c.mode::text
  ) ORDER BY c.created_at), '[]'::jsonb)
  INTO v_children
  FROM public.events c WHERE c.parent_event_id = p_event_id;

  SELECT to_jsonb(r) INTO v_resolution
  FROM (
    SELECT
      r.event_id, r.outcome_rankings, r.source::text AS source,
      r.resolution_context, r.resolved_at
    FROM public.event_resolutions r WHERE r.event_id = p_event_id
  ) r;

  IF (v_event->>'submitted_by_user_id') IS NOT NULL THEN
    SELECT jsonb_build_object('id', u.id, 'email', u.email)
    INTO v_submitter
    FROM auth.users u WHERE u.id = (v_event->>'submitted_by_user_id')::uuid;
  END IF;

  RETURN jsonb_build_object(
    'event', v_event,
    'outcomes', v_outcomes,
    'current_prediction', v_prediction,
    'children', v_children,
    'resolution', v_resolution,
    'submitter', v_submitter
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_event_detail(uuid) TO authenticated;

-- ============================================================
-- admin_edit_event - whitelist patch: title, question, description,
-- starts_at, resolves_at, metadata. Unknown keys ignored.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_edit_event(
  p_event_id uuid, p_patch jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_clean jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin']);

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch must be a JSON object';
  END IF;

  -- Whitelist scalar columns
  IF p_patch ? 'title' THEN
    v_clean := v_clean || jsonb_build_object('title', p_patch->>'title');
  END IF;
  IF p_patch ? 'question' THEN
    v_clean := v_clean || jsonb_build_object('question', p_patch->>'question');
  END IF;
  IF p_patch ? 'description' THEN
    v_clean := v_clean || jsonb_build_object('description', p_patch->>'description');
  END IF;
  IF p_patch ? 'starts_at' THEN
    v_clean := v_clean || jsonb_build_object('starts_at', p_patch->>'starts_at');
  END IF;
  IF p_patch ? 'resolves_at' THEN
    v_clean := v_clean || jsonb_build_object('resolves_at', p_patch->>'resolves_at');
  END IF;
  IF p_patch ? 'metadata' AND jsonb_typeof(p_patch->'metadata') = 'object' THEN
    v_clean := v_clean || jsonb_build_object('metadata', p_patch->'metadata');
  END IF;

  IF v_clean = '{}'::jsonb THEN
    RAISE EXCEPTION 'No editable fields provided';
  END IF;

  SELECT jsonb_build_object(
    'title', title, 'question', question, 'description', description,
    'starts_at', starts_at, 'resolves_at', resolves_at, 'metadata', metadata
  ) INTO v_before FROM public.events WHERE id = p_event_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;

  UPDATE public.events
  SET
    title       = COALESCE(v_clean->>'title', title),
    question    = COALESCE(v_clean->>'question', question),
    description = CASE WHEN v_clean ? 'description' THEN v_clean->>'description' ELSE description END,
    starts_at   = COALESCE((v_clean->>'starts_at')::timestamptz, starts_at),
    resolves_at = COALESCE((v_clean->>'resolves_at')::timestamptz, resolves_at),
    metadata    = CASE WHEN v_clean ? 'metadata' THEN v_clean->'metadata' ELSE metadata END,
    updated_at  = now()
  WHERE id = p_event_id;

  SELECT jsonb_build_object(
    'title', title, 'question', question, 'description', description,
    'starts_at', starts_at, 'resolves_at', resolves_at, 'metadata', metadata
  ) INTO v_after FROM public.events WHERE id = p_event_id;

  PERFORM public.log_admin_action(
    'event.edit', 'event', p_event_id, v_before, v_after, jsonb_build_object('patch_keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(v_clean) k))
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_edit_event(uuid, jsonb) TO authenticated;

-- ============================================================
-- admin_cancel_event
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_cancel_event(
  p_event_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_before text;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin']);
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;

  SELECT status INTO v_before FROM public.events WHERE id = p_event_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;

  UPDATE public.events SET status = 'cancelled', updated_at = now()
  WHERE id = p_event_id;

  PERFORM public.log_admin_action(
    'event.cancel', 'event', p_event_id,
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', 'cancelled'),
    jsonb_build_object('reason', p_reason)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_cancel_event(uuid, text) TO authenticated;

-- ============================================================
-- admin_pin_event - inserts into homepage_picks_daily for a date.
-- Picks first free position 1..6. Fails if all 6 taken or if event has
-- no current prediction. Uses the event's current prediction.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_pin_event(
  p_event_id uuid, p_date date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prediction_id uuid;
  v_position int;
  v_existing int;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin']);

  -- Already pinned this date? No-op idempotent.
  SELECT position INTO v_existing
  FROM public.homepage_picks_daily
  WHERE featured_date = p_date AND event_id = p_event_id
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'position', v_existing, 'already_pinned', true);
  END IF;

  SELECT id INTO v_prediction_id
  FROM public.predictions
  WHERE event_id = p_event_id AND is_current = true
  ORDER BY generated_at DESC
  LIMIT 1;
  IF v_prediction_id IS NULL THEN
    RAISE EXCEPTION 'Event has no current prediction; generate one before pinning';
  END IF;

  SELECT pos INTO v_position
  FROM generate_series(1, 6) AS gs(pos)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.homepage_picks_daily
    WHERE featured_date = p_date AND position = gs.pos
  )
  ORDER BY pos
  LIMIT 1;

  IF v_position IS NULL THEN
    RAISE EXCEPTION 'All 6 homepage slots are taken for %; unpin one first', p_date;
  END IF;

  INSERT INTO public.homepage_picks_daily (featured_date, position, event_id, prediction_id)
  VALUES (p_date, v_position, p_event_id, v_prediction_id);

  PERFORM public.log_admin_action(
    'event.pin', 'event', p_event_id,
    NULL,
    jsonb_build_object('featured_date', p_date, 'position', v_position, 'prediction_id', v_prediction_id),
    '{}'::jsonb
  );

  RETURN jsonb_build_object('ok', true, 'position', v_position, 'already_pinned', false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_pin_event(uuid, date) TO authenticated;

-- ============================================================
-- admin_unpin_event
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_unpin_event(
  p_event_id uuid, p_date date
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_pos int;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin']);

  SELECT position INTO v_pos
  FROM public.homepage_picks_daily
  WHERE featured_date = p_date AND event_id = p_event_id
  LIMIT 1;

  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Event is not pinned on %', p_date;
  END IF;

  DELETE FROM public.homepage_picks_daily
  WHERE featured_date = p_date AND event_id = p_event_id;

  PERFORM public.log_admin_action(
    'event.unpin', 'event', p_event_id,
    jsonb_build_object('featured_date', p_date, 'position', v_pos),
    NULL,
    '{}'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_unpin_event(uuid, date) TO authenticated;
