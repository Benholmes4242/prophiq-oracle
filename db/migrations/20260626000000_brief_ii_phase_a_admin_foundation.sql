-- Brief II Phase A: Admin foundation.
-- admin_users + audit_log + RPCs + Ben bootstrap.

-- ============================================================
-- 1. admin_users
-- ============================================================
CREATE TABLE public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('super_admin', 'admin', 'support', 'read_only')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  mfa_enforced boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  notes text
);

CREATE UNIQUE INDEX idx_admin_users_user_id_active
  ON public.admin_users(user_id)
  WHERE revoked_at IS NULL;

GRANT SELECT ON public.admin_users TO authenticated;
GRANT ALL    ON public.admin_users TO service_role;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_users_self_read ON public.admin_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY admin_users_super_admin_all ON public.admin_users
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users a
      WHERE a.user_id = auth.uid()
        AND a.role = 'super_admin'
        AND a.revoked_at IS NULL
    )
  );

-- ============================================================
-- 2. is_admin / get_admin_role
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = p_user_id
      AND revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.get_admin_role(p_user_id uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.admin_users
  WHERE user_id = p_user_id
    AND revoked_at IS NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_role(uuid) TO anon, authenticated;

-- ============================================================
-- 3. Bootstrap Ben as super_admin
-- ============================================================
INSERT INTO public.admin_users (user_id, role, mfa_enforced, notes)
SELECT id, 'super_admin', false, 'Bootstrap - founder, MFA optional initially'
FROM auth.users
WHERE email = 'benjamin@prophiq.io'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. audit_log
-- ============================================================
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_admin_user_id ON public.audit_log(admin_user_id, created_at DESC);
CREATE INDEX idx_audit_log_target ON public.audit_log(target_type, target_id, created_at DESC);
CREATE INDEX idx_audit_log_action ON public.audit_log(action, created_at DESC);
CREATE INDEX idx_audit_log_created_at ON public.audit_log(created_at DESC);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL    ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_admin_read ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action text,
  p_target_type text,
  p_target_id uuid DEFAULT NULL,
  p_before_state jsonb DEFAULT NULL,
  p_after_state jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_log_id uuid;
BEGIN
  SELECT id INTO v_admin_id
  FROM public.admin_users
  WHERE user_id = auth.uid() AND revoked_at IS NULL;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'log_admin_action called by non-admin user %', auth.uid();
  END IF;

  INSERT INTO public.audit_log (
    admin_user_id, action, target_type, target_id,
    before_state, after_state, metadata
  ) VALUES (
    v_admin_id, p_action, p_target_type, p_target_id,
    p_before_state, p_after_state, p_metadata
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_admin_action(text, text, uuid, jsonb, jsonb, jsonb) TO authenticated;

-- ============================================================
-- 5. admin_list_users
-- Note: this project has no `usage_log` table. "Questions" are counted
-- from public.events.submitted_by_user_id / submitted_at.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL,
  p_plan_filter text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  email text,
  signup_date timestamptz,
  last_active_at timestamptz,
  plan_tier text,
  subscription_status text,
  trial_ends_at timestamptz,
  lifetime_questions int,
  questions_this_month int,
  total_count bigint
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
      u.id,
      u.email,
      u.created_at,
      s.id AS sub_id,
      s.status AS sub_status,
      s.current_period_end,
      s.trial_end,
      pp.tier AS plan_tier
    FROM auth.users u
    LEFT JOIN public.subscriptions s
      ON s.user_id = u.id AND s.status IN ('active', 'trialing')
    LEFT JOIN public.prophiq_prices pp
      ON pp.stripe_price_id = s.stripe_price_id
    WHERE u.email IS NOT NULL
      AND (p_search IS NULL OR u.email ILIKE '%' || p_search || '%')
      AND (
        p_plan_filter IS NULL
        OR (p_plan_filter = 'free' AND s.id IS NULL)
        OR pp.tier = p_plan_filter
      )
      AND (
        p_status_filter IS NULL
        OR (p_status_filter = 'free' AND s.id IS NULL)
        OR p_status_filter = s.status
      )
  ),
  counted AS (
    SELECT b.*, count(*) OVER() AS total FROM base b
  )
  SELECT
    c.id AS user_id,
    c.email,
    c.created_at AS signup_date,
    (SELECT max(e.submitted_at) FROM public.events e WHERE e.submitted_by_user_id = c.id) AS last_active_at,
    COALESCE(c.plan_tier, 'free') AS plan_tier,
    COALESCE(c.sub_status, 'free') AS subscription_status,
    COALESCE(c.trial_end, c.current_period_end) AS trial_ends_at,
    (SELECT count(*)::int FROM public.events e WHERE e.submitted_by_user_id = c.id) AS lifetime_questions,
    (SELECT count(*)::int FROM public.events e
       WHERE e.submitted_by_user_id = c.id
         AND e.submitted_at >= date_trunc('month', now())
    ) AS questions_this_month,
    c.total AS total_count
  FROM counted c
  ORDER BY c.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_users(text, text, text, int, int) TO authenticated;

-- ============================================================
-- 6. admin_get_user_detail
-- ============================================================
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
      LIMIT 20
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
