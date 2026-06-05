-- Brief II Phase C - C.5.3: bump per-user audit strip from 20 to 50.
--
-- Body is otherwise identical to the Phase A version. Verbose because
-- CREATE OR REPLACE FUNCTION cannot patch a subquery in isolation.

CREATE OR REPLACE FUNCTION public.admin_get_user_detail(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'email_confirmed_at', u.email_confirmed_at,
      'phone', u.phone,
      'metadata', u.raw_user_meta_data
    ),
    'subscription', (
      SELECT jsonb_build_object(
        'id', s.id,
        'status', s.status,
        'stripe_subscription_id', s.stripe_subscription_id,
        'stripe_customer_id', s.stripe_customer_id,
        'current_period_start', s.current_period_start,
        'current_period_end', s.current_period_end,
        'cancel_at_period_end', s.cancel_at_period_end,
        'trial_end', s.trial_end,
        'plan_tier', pp.tier,
        'plan_cadence', pp.cadence,
        'amount_minor_units', pp.amount_minor_units,
        'currency', pp.currency,
        'daily_forecast_cap', pp.daily_forecast_cap,
        'display_name', pp.display_name
      )
      FROM public.subscriptions s
      LEFT JOIN public.prophiq_prices pp ON pp.stripe_price_id = s.stripe_price_id
      WHERE s.user_id = p_user_id
        AND s.status IN ('active', 'trialing')
      ORDER BY s.created_at DESC
      LIMIT 1
    ),
    'usage_today', (
      SELECT count(*)::int FROM public.events e
      WHERE e.submitted_by_user_id = p_user_id
        AND e.submitted_at >= date_trunc('day', now())
    ),
    'usage_this_month', (
      SELECT count(*)::int FROM public.events e
      WHERE e.submitted_by_user_id = p_user_id
        AND e.submitted_at >= date_trunc('month', now())
    ),
    'usage_lifetime', (
      SELECT count(*)::int FROM public.events e
      WHERE e.submitted_by_user_id = p_user_id
    ),
    'usage_last_7_days', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d::date, 'count', c) ORDER BY d), '[]'::jsonb)
      FROM (
        SELECT date_trunc('day', gs)::date AS d,
          (SELECT count(*)::int FROM public.events e
             WHERE e.submitted_by_user_id = p_user_id
               AND e.submitted_at >= date_trunc('day', gs)
               AND e.submitted_at <  date_trunc('day', gs) + interval '1 day'
          ) AS c
        FROM generate_series(now() - interval '6 days', now(), interval '1 day') gs
      ) s7
    ),
    'recent_questions', (
      SELECT COALESCE(jsonb_agg(q ORDER BY q->>'submitted_at' DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'event_id', e.id,
          'slug', e.slug,
          'title', e.title,
          'domain', e.domain,
          'submitted_at', e.submitted_at,
          'starts_at', e.starts_at,
          'status', e.status
        ) AS q
        FROM public.events e
        WHERE e.submitted_by_user_id = p_user_id
        ORDER BY e.submitted_at DESC NULLS LAST
        LIMIT 50
      ) qs
    ),
    'is_admin', (
      SELECT EXISTS (
        SELECT 1 FROM public.admin_users
        WHERE user_id = p_user_id AND revoked_at IS NULL
      )
    ),
    'admin_role', (
      SELECT role FROM public.admin_users
      WHERE user_id = p_user_id AND revoked_at IS NULL
      LIMIT 1
    ),
    'admin_meta', (
      SELECT jsonb_build_object(
        'mfa_enforced', mfa_enforced,
        'created_at', created_at,
        'notes', notes
      )
      FROM public.admin_users
      WHERE user_id = p_user_id AND revoked_at IS NULL
      LIMIT 1
    ),
    'suspension', (
      SELECT jsonb_build_object(
        'suspended_at', suspended_at,
        'suspended_by', suspended_by,
        'suspension_reason', suspension_reason
      )
      FROM public.profiles WHERE id = p_user_id
    ),
    'active_override', (
      SELECT jsonb_build_object(
        'id', o.id,
        'granted_tier', o.granted_tier,
        'expires_at', o.expires_at,
        'reason', o.reason,
        'created_at', o.created_at
      )
      FROM public.subscription_overrides o
      WHERE o.user_id = p_user_id AND o.revoked_at IS NULL
      ORDER BY o.created_at DESC
      LIMIT 1
    ),
    'recent_audit_log', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'action', a.action,
        'admin_email', au_user.email,
        'created_at', a.created_at,
        'metadata', a.metadata
      ) ORDER BY a.created_at DESC), '[]'::jsonb)
      FROM public.audit_log a
      JOIN public.admin_users au ON au.id = a.admin_user_id
      JOIN auth.users au_user ON au_user.id = au.user_id
      WHERE a.target_type = 'user' AND a.target_id = p_user_id
      LIMIT 50
    )
  ) INTO v_result
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_user_detail(uuid) TO authenticated;
