-- Brief II Phase C - C.6.5: Ben MFA enforcement flip.
--
-- =====================================================================
-- DO NOT RUN UNTIL Ben has successfully enrolled a TOTP factor AND
-- verified that a fresh sign-in challenges him for the 6-digit code.
-- Running this before enrollment will hard-block the sole super_admin
-- once the grace window expires.
--
-- Ship sequence:
--   1. Apply 20260628000000..20260628030000.
--   2. Deploy edge functions + frontend.
--   3. Ben enrolls via /admin/admins/me/mfa and signs in fresh.
--   4. ONLY THEN: cp this file into supabase/migrations and `supabase db push --linked`.
-- =====================================================================

UPDATE public.admin_users
SET mfa_enforced = true
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'benjamin@prophiq.io');
