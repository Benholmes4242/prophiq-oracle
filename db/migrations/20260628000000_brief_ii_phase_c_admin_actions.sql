-- Brief II Phase C - C.1: New tables + quota integration.
--
-- Adds three storage surfaces used by the admin action layer (C.2/C.7) and
-- extends the hot-path get_user_quota_today RPC to honour both:
--   * comp subscription overrides (free uplifts outside Stripe)
--   * one-off daily quota adjustments (today-only bumps)
--
-- Also adds a single-row admin_config table for the MFA enforcement start
-- date (C.6). All mutation is routed through SECURITY DEFINER RPCs in
-- the C.2 migration; only SELECT is granted directly.

-- ============================================================
-- 1. subscription_overrides - comp paid tiers outside Stripe
-- ============================================================
CREATE TABLE public.subscription_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_tier text NOT NULL CHECK (granted_tier IN ('standard', 'pro')),
  granted_by uuid NOT NULL REFERENCES public.admin_users(id),
  expires_at timestamptz,                 -- NULL = no expiry
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.admin_users(id)
);
CREATE INDEX idx_subscription_overrides_user_active
  ON public.subscription_overrides(user_id)
  WHERE revoked_at IS NULL;

GRANT SELECT ON public.subscription_overrides TO authenticated;
GRANT ALL ON public.subscription_overrides TO service_role;

ALTER TABLE public.subscription_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_overrides_admin_read ON public.subscription_overrides
  FOR SELECT TO authenticated USING (public.is_admin());

CREATE POLICY subscription_overrides_self_read ON public.subscription_overrides
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ============================================================
-- 2. quota_adjustments - one-off daily quota bumps
-- ============================================================
CREATE TABLE public.quota_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  adjustment_date date NOT NULL,
  extra_quota int NOT NULL CHECK (extra_quota > 0),
  granted_by uuid NOT NULL REFERENCES public.admin_users(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_quota_adjustments_user_date
  ON public.quota_adjustments(user_id, adjustment_date);

GRANT SELECT ON public.quota_adjustments TO authenticated;
GRANT ALL ON public.quota_adjustments TO service_role;

ALTER TABLE public.quota_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY quota_adjustments_admin_read ON public.quota_adjustments
  FOR SELECT TO authenticated USING (public.is_admin());

-- Required so SECURITY INVOKER get_user_quota_today can see the caller's own
-- adjustments. Without this, an authenticated user's adjustment row is
-- invisible to the function call and the bump silently does nothing.
CREATE POLICY quota_adjustments_self_read ON public.quota_adjustments
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ============================================================
-- 3. profiles suspension columns (soft state; preserves data)
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspended_by uuid REFERENCES public.admin_users(id),
  ADD COLUMN suspension_reason text;

-- ============================================================
-- 4. admin_config - single-row key/value (MFA enforcement date, future flags)
-- ============================================================
CREATE TABLE public.admin_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admin_config TO authenticated;
GRANT ALL ON public.admin_config TO service_role;

ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_config_admin_read ON public.admin_config
  FOR SELECT TO authenticated USING (public.is_admin());

INSERT INTO public.admin_config (key, value)
VALUES ('mfa_enforcement_start',
        to_jsonb(((now() AT TIME ZONE 'utc')::date + interval '7 days')::date::text))
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 5. Extend get_user_quota_today
--
-- Priority for the base daily cap (highest wins):
--   * Active Stripe subscription (trial -> TRIAL_CAP=100; else prophiq_prices.daily_forecast_cap)
--   * Active subscription_override -> max(prophiq_prices.daily_forecast_cap) for the granted tier
--   * FREE_CAP=3
--
-- Then add today's quota_adjustments.extra_quota on top of that base cap.
--
-- Tier label reflects the winning source. If the override raises the cap
-- above the Stripe-derived cap, subscription_status is suffixed 'comp'
-- so the UI can badge it.
--
-- Signature unchanged; submit-question and useUsageQuota are unaffected
-- aside from honouring the new sources.
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_quota_today(p_user_id uuid)
RETURNS TABLE (
  used_today           integer,
  daily_cap            integer,
  remaining            integer,
  tier                 text,
  is_trialing          boolean,
  trial_end            timestamptz,
  subscription_status  text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  FREE_CAP        constant integer := 3;
  TRIAL_CAP       constant integer := 100;
  v_used_today    integer;
  v_sub_row       record;
  v_override_row  record;
  v_override_cap  integer;
  v_stripe_cap    integer;
  v_tier          text;
  v_cap           integer;
  v_is_trialing   boolean;
  v_trial_end     timestamptz;
  v_status        text;
  v_extra_today   integer;
BEGIN
  -- Count today's submissions
  SELECT COUNT(*)::integer INTO v_used_today
  FROM events
  WHERE submitted_by_user_id = p_user_id
    AND submitted_at >= (now() AT TIME ZONE 'utc')::date
    AND submitted_at < (now() AT TIME ZONE 'utc')::date + interval '1 day';

  -- Active Stripe subscription (if any)
  SELECT
    s.status            AS status,
    s.trial_end         AS trial_end,
    p.tier              AS tier,
    p.daily_forecast_cap AS daily_forecast_cap
  INTO v_sub_row
  FROM public.subscriptions s
  JOIN public.prophiq_prices p ON p.stripe_price_id = s.stripe_price_id
  WHERE s.user_id = p_user_id
    AND s.status IN ('active', 'trialing', 'past_due')
  ORDER BY s.current_period_end DESC
  LIMIT 1;

  -- Active comp override (if any)
  SELECT o.granted_tier AS granted_tier
  INTO v_override_row
  FROM public.subscription_overrides o
  WHERE o.user_id = p_user_id
    AND o.revoked_at IS NULL
    AND (o.expires_at IS NULL OR o.expires_at > now())
  ORDER BY o.created_at DESC
  LIMIT 1;

  -- Resolve Stripe-derived cap + tier
  IF v_sub_row IS NULL THEN
    v_tier        := 'free';
    v_stripe_cap  := FREE_CAP;
    v_is_trialing := false;
    v_trial_end   := NULL;
    v_status      := 'free';
  ELSE
    v_status      := v_sub_row.status;
    v_tier        := v_sub_row.tier;
    v_is_trialing := (v_sub_row.status = 'trialing');
    v_trial_end   := v_sub_row.trial_end;
    IF v_sub_row.status = 'trialing' THEN
      v_stripe_cap := TRIAL_CAP;
    ELSE
      v_stripe_cap := v_sub_row.daily_forecast_cap;
    END IF;
  END IF;

  -- Resolve override-derived cap (max daily_forecast_cap for the granted tier)
  IF v_override_row.granted_tier IS NOT NULL THEN
    SELECT MAX(daily_forecast_cap)::integer INTO v_override_cap
    FROM public.prophiq_prices
    WHERE tier = v_override_row.granted_tier;
    IF v_override_cap IS NULL THEN
      v_override_cap := 0;
    END IF;
  ELSE
    v_override_cap := 0;
  END IF;

  -- Pick the winning source for base cap + tier label
  v_cap := GREATEST(v_stripe_cap, v_override_cap, FREE_CAP);
  IF v_override_cap > v_stripe_cap AND v_override_row.granted_tier IS NOT NULL THEN
    v_tier   := v_override_row.granted_tier;
    v_status := 'comp';
    v_is_trialing := false;
    v_trial_end   := NULL;
  END IF;

  -- Today's adjustments on top of base cap
  SELECT COALESCE(SUM(extra_quota), 0)::integer INTO v_extra_today
  FROM public.quota_adjustments
  WHERE user_id = p_user_id
    AND adjustment_date = (now() AT TIME ZONE 'utc')::date;

  v_cap := v_cap + v_extra_today;

  RETURN QUERY SELECT
    v_used_today,
    v_cap,
    GREATEST(0, v_cap - v_used_today),
    v_tier,
    v_is_trialing,
    v_trial_end,
    v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_quota_today(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION get_user_quota_today IS 'Returns the user''s daily quota state. Honours Stripe subs, comp subscription_overrides, and one-off quota_adjustments. Signature unchanged from Brief CC; status=''comp'' when an override wins.';
