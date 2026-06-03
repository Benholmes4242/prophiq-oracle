-- Brief BB: Stripe integration.
--
-- Wires the subscription rails:
--   * profiles.stripe_customer_id     (link Supabase user -> Stripe customer)
--   * prophiq_prices                  (4-row reference catalog, seeded)
--   * subscriptions                   (per-user-active subscription, mirrored from Stripe)
--   * stripe_webhook_events           (idempotency for webhook handling)
--   * get_user_active_subscription()  (single read for Brief CC entitlement checks)

-- ============================================================
-- 1. profiles.stripe_customer_id
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer
  ON profiles(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

COMMENT ON COLUMN profiles.stripe_customer_id IS 'Stripe Customer ID (cus_...) for this user. Set lazily on first checkout session creation. NULL for users who have never started a checkout.';

-- ============================================================
-- 2. prophiq_prices reference table
-- ============================================================
CREATE TABLE prophiq_prices (
  stripe_price_id     text PRIMARY KEY,
  tier                text NOT NULL CHECK (tier IN ('standard', 'pro', 'enterprise')),
  cadence             text NOT NULL CHECK (cadence IN ('monthly', 'annual')),
  amount_minor_units  integer NOT NULL,
  currency            text NOT NULL,
  daily_forecast_cap  integer NOT NULL,
  display_name        text NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prophiq_prices_tier ON prophiq_prices(tier) WHERE is_active = true;

COMMENT ON TABLE prophiq_prices IS 'Reference catalog of the Prophiq pricing plans. Each row maps a Stripe price_id to its tier + daily quota. Read by create-checkout-session (validation), get_user_active_subscription (cap lookup), and the /pricing page (Brief DD). Seeded with test-mode prices in this migration; replaced with live-mode prices before public launch.';

INSERT INTO prophiq_prices (stripe_price_id, tier, cadence, amount_minor_units, currency, daily_forecast_cap, display_name) VALUES
  ('price_1TeFzHKWWtT9LrrZVqRHavG8', 'standard', 'monthly',   600, 'gbp',  25, 'Standard Monthly'),
  ('price_1TeG1wKWWtT9LrrZ0di7b4xZ', 'standard', 'annual',   6000, 'gbp',  25, 'Standard Annual'),
  ('price_1TeG2wKWWtT9LrrZcKsKIMLG', 'pro',      'monthly',  2400, 'gbp', 100, 'Pro Monthly'),
  ('price_1TeG3dKWWtT9LrrZRoRGnlnG', 'pro',      'annual',  24000, 'gbp', 100, 'Pro Annual');

GRANT SELECT ON prophiq_prices TO anon, authenticated;
GRANT ALL    ON prophiq_prices TO service_role;

ALTER TABLE prophiq_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prophiq_prices_public_read"
  ON prophiq_prices FOR SELECT USING (true);

-- ============================================================
-- 3. subscriptions table
-- ============================================================
CREATE TABLE subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id   text NOT NULL UNIQUE,
  stripe_customer_id       text NOT NULL,
  stripe_price_id          text NOT NULL REFERENCES prophiq_prices(stripe_price_id),
  status                   text NOT NULL CHECK (status IN (
    'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'
  )),
  current_period_start     timestamptz NOT NULL,
  current_period_end       timestamptz NOT NULL,
  cancel_at_period_end     boolean NOT NULL DEFAULT false,
  canceled_at              timestamptz,
  trial_start              timestamptz,
  trial_end                timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user_status ON subscriptions(user_id, status);
CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_period_end ON subscriptions(current_period_end);

COMMENT ON TABLE subscriptions IS 'Local mirror of Stripe subscriptions. One row per Stripe subscription. Updated by stripe-webhook on every relevant event.';

GRANT SELECT ON subscriptions TO authenticated;
GRANT ALL    ON subscriptions TO service_role;

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_own_select"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "subscriptions_service_role_all"
  ON subscriptions FOR ALL
  USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.touch_subscriptions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_subscriptions_updated_at();

-- ============================================================
-- 4. stripe_webhook_events (idempotency)
-- ============================================================
CREATE TABLE stripe_webhook_events (
  stripe_event_id  text PRIMARY KEY,
  event_type       text NOT NULL,
  payload          jsonb NOT NULL,
  processed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stripe_webhook_events_type_processed
  ON stripe_webhook_events(event_type, processed_at DESC);

COMMENT ON TABLE stripe_webhook_events IS 'Idempotency record of all processed Stripe webhook events. Read at the top of stripe-webhook handler; insert at the bottom of successful processing. Old rows can be pruned by cron after 30 days.';

GRANT SELECT ON stripe_webhook_events TO service_role;
GRANT INSERT ON stripe_webhook_events TO service_role;

ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stripe_webhook_events_service_only"
  ON stripe_webhook_events FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- 5. get_user_active_subscription RPC
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_active_subscription(p_user_id uuid)
RETURNS TABLE (
  subscription_id        uuid,
  stripe_subscription_id text,
  stripe_price_id        text,
  tier                   text,
  cadence                text,
  status                 text,
  daily_forecast_cap     integer,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean,
  trial_end              timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.stripe_subscription_id,
    s.stripe_price_id,
    p.tier,
    p.cadence,
    s.status,
    p.daily_forecast_cap,
    s.current_period_start,
    s.current_period_end,
    s.cancel_at_period_end,
    s.trial_end
  FROM subscriptions s
  JOIN prophiq_prices p ON p.stripe_price_id = s.stripe_price_id
  WHERE s.user_id = p_user_id
    AND s.status IN ('active', 'trialing', 'past_due')
  ORDER BY s.current_period_end DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_active_subscription(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION get_user_active_subscription IS 'Returns the active subscription row (joined to prophiq_prices) for the user, or no row if free-tier. Used by Brief CC entitlement enforcement and Brief DD subscription UI.';
