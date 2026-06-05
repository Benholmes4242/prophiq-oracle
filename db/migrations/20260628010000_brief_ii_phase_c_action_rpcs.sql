-- Brief II Phase C - C.2: Admin action RPCs (non-Stripe) + audit list RPCs.
--
-- Every RPC is SECURITY DEFINER, role-gates via admin_require_role(),
-- mutates, then writes a single audit row via log_admin_action.
-- Role gates per brief section 6. Destructive-action confirmation is
-- enforced in the UI; the RPCs enforce the role + reason invariants.

-- ============================================================
-- Helper: role gate
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_require_role(p_roles text[])
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role text;
BEGIN
  v_role := public.get_admin_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF NOT (v_role = ANY(p_roles)) THEN
    RAISE EXCEPTION 'Insufficient role: % not in %', v_role, p_roles;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_require_role(text[]) TO authenticated;

-- Helper: resolve the calling admin's admin_users.id (active row).
CREATE OR REPLACE FUNCTION public.admin_caller_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.admin_users
  WHERE user_id = auth.uid() AND revoked_at IS NULL
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.admin_caller_id() TO authenticated;

-- ============================================================
-- admin_grant_pro
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_grant_pro(
  p_user_id uuid, p_tier text, p_expires_at timestamptz, p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_override_id uuid;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin','support']);
  IF p_tier NOT IN ('standard','pro') THEN
    RAISE EXCEPTION 'Invalid tier %', p_tier;
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id AND email IS NOT NULL) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  v_admin_id := public.admin_caller_id();

  INSERT INTO public.subscription_overrides (user_id, granted_tier, granted_by, expires_at, reason)
  VALUES (p_user_id, p_tier, v_admin_id, p_expires_at, p_reason)
  RETURNING id INTO v_override_id;

  PERFORM public.log_admin_action(
    'user.grant_pro', 'user', p_user_id,
    NULL,
    jsonb_build_object('override_id', v_override_id, 'tier', p_tier, 'expires_at', p_expires_at),
    jsonb_build_object('reason', p_reason)
  );
  RETURN v_override_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_grant_pro(uuid, text, timestamptz, text) TO authenticated;

-- ============================================================
-- admin_revoke_pro
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_revoke_pro(
  p_override_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_row record;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin','support']);
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;

  SELECT id, user_id, granted_tier, expires_at, revoked_at
  INTO v_row
  FROM public.subscription_overrides
  WHERE id = p_override_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Override not found'; END IF;
  IF v_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Override already revoked'; END IF;

  v_admin_id := public.admin_caller_id();

  UPDATE public.subscription_overrides
  SET revoked_at = now(), revoked_by = v_admin_id
  WHERE id = p_override_id;

  PERFORM public.log_admin_action(
    'user.revoke_pro', 'user', v_row.user_id,
    jsonb_build_object('override_id', v_row.id, 'tier', v_row.granted_tier, 'expires_at', v_row.expires_at),
    jsonb_build_object('override_id', v_row.id, 'revoked_at', now()),
    jsonb_build_object('reason', p_reason)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_revoke_pro(uuid, text) TO authenticated;

-- ============================================================
-- admin_adjust_quota
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_adjust_quota(
  p_user_id uuid, p_extra int, p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_id uuid;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin','support']);
  IF p_extra IS NULL OR p_extra <= 0 THEN
    RAISE EXCEPTION 'extra_quota must be > 0';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  v_admin_id := public.admin_caller_id();

  INSERT INTO public.quota_adjustments (user_id, adjustment_date, extra_quota, granted_by, reason)
  VALUES (p_user_id, (now() AT TIME ZONE 'utc')::date, p_extra, v_admin_id, p_reason)
  RETURNING id INTO v_id;

  PERFORM public.log_admin_action(
    'user.adjust_quota', 'user', p_user_id,
    NULL,
    jsonb_build_object('adjustment_id', v_id, 'extra_quota', p_extra, 'date', (now() AT TIME ZONE 'utc')::date),
    jsonb_build_object('reason', p_reason)
  );
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_adjust_quota(uuid, int, text) TO authenticated;

-- ============================================================
-- admin_suspend_user
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_suspend_user(
  p_user_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_before jsonb;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin']);
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  v_admin_id := public.admin_caller_id();

  SELECT jsonb_build_object(
    'suspended_at', suspended_at,
    'suspended_by', suspended_by,
    'suspension_reason', suspension_reason
  ) INTO v_before
  FROM public.profiles WHERE id = p_user_id;

  UPDATE public.profiles
  SET suspended_at = now(), suspended_by = v_admin_id, suspension_reason = p_reason
  WHERE id = p_user_id;

  PERFORM public.log_admin_action(
    'user.suspend', 'user', p_user_id,
    v_before,
    jsonb_build_object('suspended_at', now(), 'suspended_by', v_admin_id, 'suspension_reason', p_reason),
    jsonb_build_object('reason', p_reason)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_suspend_user(uuid, text) TO authenticated;

-- ============================================================
-- admin_unsuspend_user
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_unsuspend_user(
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before jsonb;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin']);

  SELECT jsonb_build_object(
    'suspended_at', suspended_at,
    'suspended_by', suspended_by,
    'suspension_reason', suspension_reason
  ) INTO v_before
  FROM public.profiles WHERE id = p_user_id;

  IF v_before IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  UPDATE public.profiles
  SET suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL
  WHERE id = p_user_id;

  PERFORM public.log_admin_action(
    'user.unsuspend', 'user', p_user_id,
    v_before,
    jsonb_build_object('suspended_at', NULL, 'suspended_by', NULL, 'suspension_reason', NULL),
    '{}'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_unsuspend_user(uuid) TO authenticated;

-- ============================================================
-- admin_approve_question
-- Sets moderation_status='approved'. UI is responsible for invoking
-- generate-prediction after the RPC returns (open question 1 default).
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_approve_question(
  p_event_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before text;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin','support']);

  SELECT moderation_status INTO v_before
  FROM public.events WHERE id = p_event_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;

  UPDATE public.events
  SET moderation_status = 'approved'
  WHERE id = p_event_id;

  PERFORM public.log_admin_action(
    'event.approve_moderation', 'event', p_event_id,
    jsonb_build_object('moderation_status', v_before),
    jsonb_build_object('moderation_status', 'approved'),
    '{}'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_approve_question(uuid) TO authenticated;

-- ============================================================
-- admin_reject_question
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_reject_question(
  p_event_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before text;
  v_meta jsonb;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin','support']);
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;

  SELECT moderation_status, COALESCE(metadata, '{}'::jsonb)
  INTO v_before, v_meta
  FROM public.events WHERE id = p_event_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;

  UPDATE public.events
  SET moderation_status = 'rejected',
      metadata = v_meta || jsonb_build_object(
        'moderation_rejection', jsonb_build_object(
          'reason', p_reason,
          'rejected_at', now()
        )
      )
  WHERE id = p_event_id;

  PERFORM public.log_admin_action(
    'event.reject_moderation', 'event', p_event_id,
    jsonb_build_object('moderation_status', v_before),
    jsonb_build_object('moderation_status', 'rejected'),
    jsonb_build_object('reason', p_reason)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_reject_question(uuid, text) TO authenticated;

-- ============================================================
-- admin_force_delete_user
-- Snapshot -> audit -> cascade. audit_log.target_id has no FK to auth.users,
-- so the audit row survives the cascade.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_force_delete_user(
  p_user_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_event_count int;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin']);
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;

  SELECT COUNT(*)::int INTO v_event_count
  FROM public.events WHERE submitted_by_user_id = p_user_id;

  SELECT jsonb_build_object(
    'user', (SELECT jsonb_build_object(
        'id', u.id, 'email', u.email, 'created_at', u.created_at
      ) FROM auth.users u WHERE u.id = p_user_id),
    'profile', (SELECT to_jsonb(p) FROM public.profiles p WHERE p.id = p_user_id),
    'subscription', (SELECT to_jsonb(s) FROM public.subscriptions s
                     WHERE s.user_id = p_user_id ORDER BY s.created_at DESC LIMIT 1),
    'override', (SELECT to_jsonb(o) FROM public.subscription_overrides o
                 WHERE o.user_id = p_user_id AND o.revoked_at IS NULL
                 ORDER BY o.created_at DESC LIMIT 1),
    'event_count', v_event_count
  ) INTO v_before;

  -- Audit FIRST so the record survives the cascade.
  PERFORM public.log_admin_action(
    'user.force_delete', 'user', p_user_id,
    v_before,
    NULL,
    jsonb_build_object('reason', p_reason)
  );

  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_force_delete_user(uuid, text) TO authenticated;

-- ============================================================
-- admin_log_stripe_action - thin wrapper called by admin-stripe-actions
-- edge function (as the caller, not service-role) so log_admin_action's
-- auth.uid() lookup resolves to the calling admin.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_log_stripe_action(
  p_action text,
  p_target_id uuid,
  p_before_state jsonb,
  p_after_state jsonb,
  p_metadata jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.admin_require_role(ARRAY['super_admin','admin']);
  v_id := public.log_admin_action(
    p_action, 'subscription', p_target_id, p_before_state, p_after_state, p_metadata
  );
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_log_stripe_action(text, uuid, jsonb, jsonb, jsonb) TO authenticated;

-- ============================================================
-- admin_list_audit + admin_distinct_audit_actions
-- All varchar/enum columns cast ::text to avoid 42804.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_audit(
  p_admin_user_id uuid DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_target_type text DEFAULT NULL,
  p_target_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
) RETURNS TABLE (
  id uuid, action text, target_type text, target_id uuid,
  admin_email text, admin_role text,
  before_state jsonb, after_state jsonb, metadata jsonb,
  created_at timestamptz, total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN QUERY
  WITH base AS (
    SELECT
      a.id, a.action, a.target_type, a.target_id,
      u.email AS admin_email, au.role AS admin_role,
      a.before_state, a.after_state, a.metadata,
      a.created_at, a.admin_user_id
    FROM public.audit_log a
    JOIN public.admin_users au ON au.id = a.admin_user_id
    JOIN auth.users u ON u.id = au.user_id
    WHERE (p_admin_user_id IS NULL OR a.admin_user_id = p_admin_user_id)
      AND (p_action IS NULL OR a.action = p_action)
      AND (p_target_type IS NULL OR a.target_type = p_target_type)
      AND (p_target_id IS NULL OR a.target_id = p_target_id)
      AND (p_from IS NULL OR a.created_at >= p_from)
      AND (p_to IS NULL OR a.created_at <= p_to)
      AND (p_search IS NULL
           OR a.target_id::text ILIKE '%' || p_search || '%'
           OR u.email ILIKE '%' || p_search || '%')
  ), counted AS (
    SELECT b.*, count(*) OVER() AS total FROM base b
  )
  SELECT
    c.id, c.action::text, c.target_type::text, c.target_id,
    c.admin_email::text, c.admin_role::text,
    c.before_state, c.after_state, c.metadata,
    c.created_at, c.total
  FROM counted c
  ORDER BY c.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_audit(uuid,text,text,uuid,text,timestamptz,timestamptz,int,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_distinct_audit_actions()
RETURNS TABLE (action text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN QUERY
    SELECT DISTINCT a.action::text
    FROM public.audit_log a
    ORDER BY 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_distinct_audit_actions() TO authenticated;
