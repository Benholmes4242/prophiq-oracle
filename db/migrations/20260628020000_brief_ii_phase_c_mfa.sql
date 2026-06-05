-- Brief II Phase C - C.6: MFA support storage.
--
-- Adds the recovery code hash column used by admin-mfa-recovery.
-- Supabase's TOTP enroll response does not itself provide a recovery code,
-- so we mint one server-side (single random code), hash it, and store
-- only the hash here. Plaintext is returned once at enrollment time.

ALTER TABLE public.admin_users
  ADD COLUMN recovery_code_hash text,
  ADD COLUMN recovery_code_set_at timestamptz,
  ADD COLUMN mfa_last_verified_at timestamptz;

COMMENT ON COLUMN public.admin_users.recovery_code_hash IS 'sha256 hex of the single TOTP recovery code. Set by admin-mfa-recovery at enrollment; consumed and cleared on recovery use.';
COMMENT ON COLUMN public.admin_users.mfa_last_verified_at IS 'Last successful aal2 verification. Used by admin layout to enforce 12h re-verification.';
