# Phase II.C — Admin actions + Audit UI + MFA enforcement

## Preflight audit (items 1–7 vs. brief)

All 7 confirmed against current source:

1. ✅ `db/migrations/` is source of truth; last slot `20260627020000`. Next free: `20260628000000`.
2. ✅ `profiles` has `id, email, is_anonymous, display_name, metadata, email_upgraded_at, created_at, updated_at`. No suspension columns yet.
3. ✅ `get_user_quota_today` is `SECURITY INVOKER STABLE`, returns the 7-col TABLE; `FREE_CAP := 3`, `TRIAL_CAP := 100`; paid cap from `prophiq_prices.daily_forecast_cap`. Signature must stay.
4. ✅ `submit-question` enforces via `get_user_quota_today` at SSE stage `rate_limit`.
5. ✅ `admin_users` (with `revoked_at`, `mfa_enforced`, `role`), `audit_log` (`target_id uuid` is bare, no FK to `auth.users` — confirmed at line 88), `is_admin()`, `get_admin_role()`, `log_admin_action(...)`. `admin_get_user_detail` limits audit strip to 20 (line 351–361).
6. ✅ Edge helpers as described: `requireAuthenticatedUser`, `getStripeClient`, `_shared/http.ts`, `--no-verify-jwt`.
7. ✅ `raise_admin_notification(...)` live from Phase B.

**No divergences.** Defaults applied for open questions: (1) prediction dispatch on approve → frontend `functions.invoke` (do not rely on GUC in admin RPC); (2) recovery code → hashed in `admin_users.recovery_code_hash`, plaintext returned once; (3) refund → admin selects a specific charge from last 30 days; (4) suspension UX → silent block in `submit-question`, no visible state on user's own page.

## Slices (will ship in this order)

### Slice 1 — DB foundation
`20260628000000_brief_ii_phase_c_admin_actions.sql`
- `subscription_overrides`, `quota_adjustments`, `profiles.suspended_*` columns
- `admin_config` (single-row key/value) seeded with `mfa_enforcement_start = today + 7d`
- RLS: admin-read + self-read on overrides & adjustments
- Extend `get_user_quota_today` keeping signature: greatest of (Stripe, override) cap + today's `quota_adjustments.extra_quota`; if override wins, `subscription_status = 'comp'`
- All GRANTs per house rule

### Slice 2 — Action RPCs
`20260628010000_brief_ii_phase_c_action_rpcs.sql`
- `admin_require_role(text[])`
- 7 RPCs: `admin_grant_pro`, `admin_revoke_pro`, `admin_adjust_quota`, `admin_suspend_user`, `admin_unsuspend_user`, `admin_approve_question`, `admin_reject_question`, `admin_force_delete_user` (snapshot → audit → cascade)
- `admin_list_audit(...)` + `admin_distinct_audit_actions()` with `::text` casts
- `admin_approve_question` does NOT dispatch; UI invokes `generate-prediction` after the RPC returns

### Slice 3 — MFA migration + Ben flip (separate file, ship last)
- `20260628020000_brief_ii_phase_c_mfa.sql`: `admin_users.recovery_code_hash text`
- `20260628030000_brief_ii_phase_c_user_detail_audit_bump.sql`: raise `admin_get_user_detail` audit limit 20→50
- `20260628040000_brief_ii_phase_c_ben_mfa_flip.sql`: **separate, do not auto-apply**; flagged in deploy notes

### Slice 4 — Edge functions
- `admin-stripe-actions/index.ts`: dual-client pattern (caller JWT for `admin_require_role` check; service role for Stripe + DB writes). Actions: `force_cancel` (delegates state to `stripe-webhook`), `refund` (30-day window enforced server-side). Audits via a small `admin_log_stripe_action` wrapper RPC executed as caller.
- `admin-auth-actions/index.ts`: `resend_otp` via Supabase Admin API; audited.
- `admin-mfa-recovery/index.ts`: generate code, store bcrypt-ish hash in `admin_users.recovery_code_hash`, return plaintext once; verify path clears TOTP factor via admin API and forces re-enroll.

### Slice 5 — Suspension enforcement
- `submit-question/index.ts`: single `profiles.suspended_at` select BEFORE `get_user_quota_today`; emit SSE `suspended` stage with neutral message; bail.

### Slice 6 — Frontend libs + Audit UI
- `src/lib/admin/actions.ts` — typed wrappers for all 8 RPCs + 3 edge invokes
- `src/lib/admin/audit.ts` — `adminListAudit`, `adminDistinctAuditActions`
- `src/lib/admin/mfa.ts` — enroll/challenge/verify/AAL/recovery helpers
- `src/routes/admin.audit.tsx` — URL-driven filters (admin, action multi-select, target_type, date range, search), table, row drawer with pretty JSON, CSV export (cap 5000), pagination
- `AdminSidebar.tsx`: wire "Audit" → `/admin/audit`, remove `comingSoon`

### Slice 7 — User detail Actions panel + MFA gate/banner
- `src/components/admin/UserActionsPanel.tsx`: 9 buttons with role-gating + typed confirmation modals; inline "Comp Pro" / "Suspended" badges
- `admin.users.$id.tsx`: mount panel; "View full audit log for this user" link → `/admin/audit?target_id=…`; remove "coming in Phase II.C" copy
- `MfaBanner.tsx` + `MfaEnrollModal.tsx`: shown when required-role admin lacks verified factor; enforcement date from `admin_config`
- `src/routes/admin.tsx` `beforeLoad`: extend to check `mfa.getAuthenticatorAssuranceLevel()`; pre-grace allow + banner, post-grace hard block; if factor exists and AAL≠aal2, redirect to challenge screen; failed challenges call `raise_admin_notification('warning','security',...)` + audit `admin.mfa_challenge_failed`
- 12h aal2 re-verification tracked in session state

## Verification per slice
- Slices 1–3 (SQL): careful review only (no local psql).
- Slice 4 (edge fns): code review; not built by Vite.
- Slices 5–7 (frontend + submit-question changes): `bun run build` after each.
- Final acceptance items requiring real Stripe / live MFA challenges flagged as Ben's post-deploy verification.

## Out of scope (per brief §15)
Per-admin audit route, prediction auto-resolution, revenue dashboards, events moderation queue page, audit retention GC, WebAuthn/SMS MFA, GDPR export.

## Risks
1. `get_user_quota_today` extension is on the hot path — signature preserved, RLS self-read policies added, no submit-question break.
2. `admin-stripe-actions` dual-client auth-as-caller — the security crux; will follow brief exactly.
3. Ben MFA flip must NOT auto-apply — shipped as a separate, clearly-marked migration that Ben copies into `supabase/migrations/` only after enrollment.

Ready to ship Slice 1 on approval.
