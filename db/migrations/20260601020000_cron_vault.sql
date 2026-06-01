-- ============================================================
-- Phase 5 patch: migrate cron helpers from ALTER DATABASE … SET
-- to Supabase Vault.  This migration ONLY replaces the two
-- secret-reading helpers and their grants.  Everything else
-- (prophiq_call_edge, the three cron_* functions, and the job
-- schedules) stays untouched in 20260601010000_cron.sql.
--
-- Prerequisites (run once via Dashboard → Project Settings → Vault):
--   prophiq_supabase_url      = https://<ref>.supabase.co
--   prophiq_service_role_key  = <service-role key>
-- ============================================================

-- ------------------------------------------------------------
-- Helper: read configured edge-function base URL from Vault.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prophiq_edge_url(fn_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE base text;
BEGIN
  SELECT decrypted_secret INTO base
  FROM vault.decrypted_secrets
  WHERE name = 'prophiq_supabase_url';

  IF base IS NULL OR base = '' THEN
    RAISE EXCEPTION 'Vault secret "prophiq_supabase_url" is not set. Store it in Supabase Vault (Dashboard → Project Settings → Vault).';
  END IF;
  RETURN rtrim(base, '/') || '/functions/v1/' || fn_name;
END;
$$;

-- ------------------------------------------------------------
-- Helper: read service-role key from Vault.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prophiq_service_key()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE k text;
BEGIN
  SELECT decrypted_secret INTO k
  FROM vault.decrypted_secrets
  WHERE name = 'prophiq_service_role_key';

  IF k IS NULL OR k = '' THEN
    RAISE EXCEPTION 'Vault secret "prophiq_service_role_key" is not set. Store it in Supabase Vault (Dashboard → Project Settings → Vault).';
  END IF;
  RETURN k;
END;
$$;

-- Grants: revoke public access to the secret-reading helpers.
REVOKE ALL ON FUNCTION public.prophiq_edge_url(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prophiq_service_key()  FROM PUBLIC;
