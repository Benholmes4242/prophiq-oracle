-- =====================================================================
-- SQL FOR BEN TO RUN -- Prophiq Part A pricing + quota update
-- Run in Supabase SQL editor AFTER creating the four new Stripe Prices.
--
-- Replace the four 'price_NEW_*' placeholders with the live-mode price
-- IDs recorded in Step 1 of the brief. Do NOT delete the old rows --
-- existing subscribers stay on their grandfathered prices and quotas
-- (their subscription.stripe_price_id still resolves via prophiq_prices,
-- so get_user_quota_today / get_user_active_subscription keep returning
-- the old daily_forecast_cap for them).
--
-- New numbers:
--   Standard Monthly  GBP 9.99   ->  999  pence,  15/day
--   Standard Annual   GBP 109.89 -> 10989 pence,  15/day  (monthly x 11)
--   Pro Monthly       GBP 29.99  -> 2999  pence,  40/day
--   Pro Annual        GBP 329.89 -> 32989 pence,  40/day  (monthly x 11)
-- =====================================================================

BEGIN;

-- 1. Insert the four new active rows.
INSERT INTO public.prophiq_prices
  (stripe_price_id, tier, cadence, amount_minor_units, currency, daily_forecast_cap, display_name, is_active)
VALUES
  ('price_NEW_STANDARD_MONTHLY_9_99',  'standard', 'monthly',   999, 'gbp', 15, 'Standard Monthly', true),
  ('price_NEW_STANDARD_ANNUAL_109_89', 'standard', 'annual',  10989, 'gbp', 15, 'Standard Annual',  true),
  ('price_NEW_PRO_MONTHLY_29_99',      'pro',      'monthly',  2999, 'gbp', 40, 'Pro Monthly',      true),
  ('price_NEW_PRO_ANNUAL_329_89',      'pro',      'annual',  32989, 'gbp', 40, 'Pro Annual',       true);

-- 2. Hide the OLD rows from the /pricing page (new signups must only see
--    the new prices) but keep them in the table so grandfathered
--    subscribers' stripe_price_id still joins and resolves their quota.
UPDATE public.prophiq_prices
   SET is_active = false
 WHERE stripe_price_id IN (
   'price_1TeFzHKWWtT9LrrZVqRHavG8',  -- Standard Monthly GBP 6
   'price_1TeG1wKWWtT9LrrZ0di7b4xZ',  -- Standard Annual  GBP 60
   'price_1TeG2wKWWtT9LrrZcKsKIMLG',  -- Pro Monthly      GBP 24
   'price_1TeG3dKWWtT9LrrZRoRGnlnG'   -- Pro Annual       GBP 240
 );

-- 3. Sanity checks (read-only -- review before COMMIT).
SELECT stripe_price_id, tier, cadence, amount_minor_units, daily_forecast_cap, is_active
  FROM public.prophiq_prices
 ORDER BY is_active DESC, tier, cadence;

COMMIT;
