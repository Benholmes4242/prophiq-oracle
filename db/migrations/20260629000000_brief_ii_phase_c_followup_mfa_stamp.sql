-- Brief II Phase C follow-up: MFA last-verified stamp + reader.
-- Used by the admin gate to enforce a 12h re-challenge window on top of
-- Supabase's authoritative AAL level.

CREATE OR REPLACE FUNCTION public.admin_stamp_mfa_verified()
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_now timestamptz := now();
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  UPDATE public.admin_users
  SET mfa_last_verified_at = v_now
  WHERE user_id = auth.uid() AND revoked_at IS NULL;
  RETURN v_now;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_stamp_mfa_verified() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_mfa_verified()
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT mfa_last_verified_at FROM public.admin_users
  WHERE user_id = auth.uid() AND revoked_at IS NULL;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_mfa_verified() TO authenticated;
