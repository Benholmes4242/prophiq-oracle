-- Brief FF v2 / Phase C — Fix get_event_with_children for child slugs.
--
-- The previous implementation built parent_row + child_rows as CTEs and
-- read them via scalar subqueries inside jsonb_build_object. In practice
-- this returned NULL for child-slug lookups. Rewrite to assemble parent
-- and children into local jsonb variables explicitly, so child URLs
-- resolve up to the parent and return the full family payload.

CREATE OR REPLACE FUNCTION public.get_event_with_children(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id   uuid;
  v_parent_id  uuid;
  v_resolved   boolean := false;
  v_parent     jsonb;
  v_children   jsonb;
BEGIN
  SELECT id, parent_event_id
    INTO v_event_id, v_parent_id
  FROM public.events
  WHERE slug = p_slug
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_parent_id IS NOT NULL THEN
    v_resolved := true;
  ELSE
    v_parent_id := v_event_id;
  END IF;

  -- Parent event + its current prediction.
  SELECT jsonb_build_object(
    'event', to_jsonb(e.*),
    'prediction', (
      SELECT to_jsonb(p.*)
      FROM public.v_predictions_public p
      WHERE p.event_id = e.id
        AND p.is_current = true
        AND p.mode = (CASE WHEN e.mode = 'odds' THEN 'odds' ELSE 'prediction' END)
      ORDER BY p.generated_at DESC
      LIMIT 1
    )
  )
  INTO v_parent
  FROM public.events e
  WHERE e.id = v_parent_id;

  IF v_parent IS NULL THEN
    -- Parent row vanished (deleted/cascade race). Treat as not found.
    RETURN NULL;
  END IF;

  -- Children (ordered) — each with its current prediction.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'event', to_jsonb(c.*),
        'prediction', (
          SELECT to_jsonb(p.*)
          FROM public.v_predictions_public p
          WHERE p.event_id = c.id
            AND p.is_current = true
            AND p.mode = (CASE WHEN c.mode = 'odds' THEN 'odds' ELSE 'prediction' END)
          ORDER BY p.generated_at DESC
          LIMIT 1
        )
      )
      ORDER BY c.starts_at ASC NULLS LAST, c.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_children
  FROM public.events c
  WHERE c.parent_event_id = v_parent_id;

  RETURN jsonb_build_object(
    'resolved_from_child', v_resolved,
    'parent',   v_parent,
    'children', v_children
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_with_children(text)
  TO anon, authenticated, service_role;
