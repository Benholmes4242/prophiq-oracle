-- Brief CC: Entitlement enforcement.
--
-- Single source of truth for "what is this user allowed to do today?" -
-- the get_user_quota_today RPC. Replaces the hardcoded FREE_DAILY_CAP = 3
-- enforcement in submit-question with a per-tier lookup that respects
-- active subscriptions, trialing state, and past_due grace periods.

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
  v_tier          text;
  v_cap           integer;
  v_is_trialing   boolean;
  v_trial_end     timestamptz;
  v_status        text;
BEGIN
  -- Count today's submissions (mirrors Brief AA's get_usage_today_for_user)
  SELECT COUNT(*)::integer INTO v_used_today
  FROM events
  WHERE submitted_by_user_id = p_user_id
    AND submitted_at >= (now() AT TIME ZONE 'utc')::date
    AND submitted_at < (now() AT TIME ZONE 'utc')::date + interval '1 day';

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

  IF v_sub_row IS NULL THEN
    v_tier        := 'free';
    v_cap         := FREE_CAP;
    v_is_trialing := false;
    v_trial_end   := NULL;
    v_status      := 'free';
  ELSE
    v_status      := v_sub_row.status;
    v_tier        := v_sub_row.tier;
    v_is_trialing := (v_sub_row.status = 'trialing');
    v_trial_end   := v_sub_row.trial_end;

    IF v_sub_row.status = 'trialing' THEN
      v_cap := TRIAL_CAP;
    ELSE
      v_cap := v_sub_row.daily_forecast_cap;
    END IF;
  END IF;

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

COMMENT ON FUNCTION get_user_quota_today IS 'Returns the user''s daily quota state (used / cap / remaining / tier / trial info). Single source of truth for entitlement decisions. Used by submit-question for enforcement and useUsageQuota for display.';
