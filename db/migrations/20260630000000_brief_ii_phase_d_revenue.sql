-- Brief II Phase D - D.1: Revenue dashboards.
--
-- Hybrid local+Stripe approach: webhook-driven subscriptions + prophiq_prices
-- power fast read RPCs. Stripe ground truth (refunds, recoveries) lives in
-- the admin-revenue-sync edge function for on-demand reconciliation.
--
-- All RPCs SECURITY DEFINER, is_admin() guarded, search_path = public.
-- Money is in minor units; client divides for display. Every varchar/enum
-- column is cast to text in RETURNS TABLE to avoid 42804.

-- ============================================================
-- admin_revenue_metrics: single jsonb snapshot
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_revenue_metrics(
  p_period_start timestamptz DEFAULT date_trunc('month', now()),
  p_period_end   timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;

  SELECT jsonb_build_object(
    'mrr_minor', (
      SELECT COALESCE(sum(
        CASE WHEN pp.cadence = 'annual' THEN pp.amount_minor_units / 12
             ELSE pp.amount_minor_units END), 0)::bigint
      FROM public.subscriptions s
      JOIN public.prophiq_prices pp ON pp.stripe_price_id = s.stripe_price_id
      WHERE s.status = 'active'
    ),
    'currency', (SELECT currency::text FROM public.prophiq_prices WHERE is_active LIMIT 1),
    'active_count',   (SELECT count(*)::bigint FROM public.subscriptions WHERE status = 'active'),
    'trialing_count', (SELECT count(*)::bigint FROM public.subscriptions WHERE status = 'trialing'),
    'past_due_count', (SELECT count(*)::bigint FROM public.subscriptions WHERE status = 'past_due'),
    'canceled_in_period', (
      SELECT count(*)::bigint FROM public.subscriptions
      WHERE status = 'canceled'
        AND canceled_at >= p_period_start AND canceled_at <= p_period_end
    ),
    'new_in_period', (
      SELECT count(*)::bigint FROM public.subscriptions
      WHERE created_at >= p_period_start AND created_at <= p_period_end
    ),
    'trial_to_paid', (
      SELECT jsonb_build_object(
        'trials_started', count(*) FILTER (
          WHERE trial_start IS NOT NULL
            AND trial_start >= p_period_start
            AND trial_start <= p_period_end
        )::bigint,
        'converted', count(*) FILTER (
          WHERE trial_start IS NOT NULL
            AND trial_start >= p_period_start
            AND trial_start <= p_period_end
            AND status = 'active'
        )::bigint
      ) FROM public.subscriptions
    ),
    'period_start', p_period_start,
    'period_end',   p_period_end
  ) INTO v;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_revenue_metrics(timestamptz, timestamptz) TO authenticated;

-- ============================================================
-- admin_mrr_history: monthly reconstructed MRR (approximation)
--
-- Limitation: uses current subscription rows to reconstruct historic
-- MRR. Cannot see historical plan changes (Stripe ground truth needed
-- for that). Acceptable for V1.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_mrr_history(p_months int DEFAULT 12)
RETURNS TABLE (month_start date, mrr_minor bigint, active_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  RETURN QUERY
  WITH months AS (
    SELECT generate_series(
      date_trunc('month', now()) - make_interval(months => p_months - 1),
      date_trunc('month', now()),
      interval '1 month'
    )::date AS m
  )
  SELECT
    months.m,
    COALESCE(sum(
      CASE WHEN pp.cadence = 'annual' THEN pp.amount_minor_units / 12
           ELSE pp.amount_minor_units END), 0)::bigint,
    count(s.id)::bigint
  FROM months
  LEFT JOIN public.subscriptions s
    ON s.created_at < (months.m + interval '1 month')
   AND (s.canceled_at IS NULL OR s.canceled_at >= (months.m + interval '1 month'))
   AND s.status IN ('active','trialing','past_due','canceled')
  LEFT JOIN public.prophiq_prices pp ON pp.stripe_price_id = s.stripe_price_id
  GROUP BY months.m
  ORDER BY months.m;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_mrr_history(int) TO authenticated;

-- ============================================================
-- admin_plan_distribution: count per (tier, cadence)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_plan_distribution()
RETURNS TABLE (tier text, cadence text, sub_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  RETURN QUERY
  SELECT pp.tier::text, pp.cadence::text, count(s.id)::bigint
  FROM public.subscriptions s
  JOIN public.prophiq_prices pp ON pp.stripe_price_id = s.stripe_price_id
  WHERE s.status IN ('active','trialing')
  GROUP BY pp.tier, pp.cadence
  ORDER BY pp.tier, pp.cadence;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_plan_distribution() TO authenticated;

-- ============================================================
-- admin_top_customers: by local estimate of lifetime spend
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_top_customers(p_limit int DEFAULT 20)
RETURNS TABLE (
  user_id uuid,
  email text,
  tier text,
  cadence text,
  signup_date timestamptz,
  est_lifetime_minor bigint,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    pp.tier::text,
    pp.cadence::text,
    u.created_at,
    (
      GREATEST(
        1,
        EXTRACT(EPOCH FROM age(COALESCE(s.canceled_at, now()), s.created_at))::numeric
          / (60 * 60 * 24 * 30)
      )::numeric
      * CASE WHEN pp.cadence = 'annual' THEN pp.amount_minor_units / 12
             ELSE pp.amount_minor_units END
    )::bigint AS est_lifetime_minor,
    s.status::text
  FROM public.subscriptions s
  JOIN public.prophiq_prices pp ON pp.stripe_price_id = s.stripe_price_id
  JOIN auth.users u ON u.id = s.user_id
  ORDER BY est_lifetime_minor DESC NULLS LAST
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_top_customers(int) TO authenticated;
