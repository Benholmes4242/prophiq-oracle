-- get_usage_today(): shared daily quota across submit_question and chat_message.
-- Returns { used, total, remaining }. Counts accepted submissions in the last
-- 24h matching either fingerprint OR ip_hash (matches the rate limiter's
-- union-bucket semantics).
--
-- TODO (monetization): replace hardcoded `total = 3` with a per-entitlement
-- lookup against user_entitlements when paid tiers ship. The signature
-- stays stable.

CREATE OR REPLACE FUNCTION public.get_usage_today(
  p_fingerprint text,
  p_ip_hash text DEFAULT NULL
)
RETURNS TABLE (
  used integer,
  total integer,
  remaining integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH counts AS (
    SELECT count(*)::int AS n
    FROM public.submission_rate_limits
    WHERE outcome = 'accepted'
      AND endpoint IN ('submit_question', 'chat_message')
      AND submitted_at >= now() - interval '24 hours'
      AND (
        (p_fingerprint IS NOT NULL AND fingerprint = p_fingerprint)
        OR (p_ip_hash IS NOT NULL AND ip_hash = p_ip_hash)
      )
  )
  SELECT
    LEAST(n, 3) AS used,
    3 AS total,
    GREATEST(3 - n, 0) AS remaining
  FROM counts;
$$;

GRANT EXECUTE ON FUNCTION public.get_usage_today(text, text) TO anon, authenticated;
