## Audit findings (preflight 1–7)

All 7 preflight items confirmed against the codebase:

1. ✅ `db/migrations/` is source of truth; next slot `20260627000000` is free.
2. ✅ No `usage_log` table anywhere — events submission counting confirmed in the Phase A migration's own comment.
3. ✅ `prophiq_call_edge(fn_name, body jsonb)` pattern in `db/migrations/20260601010000_cron.sql`, used by every existing cron.
4. ✅ `_shared/http.ts` exports `handleCorsPreflight`, `jsonResponse`, `errorResponse`; `_shared/supabaseClient.ts` exports `getServiceClient`; `readEnv` pattern in `_shared/llm.ts`.
5. ✅ Admin shell exists (`admin.tsx`, `AdminSidebar.tsx`, `AdminHeader.tsx`, `lib/admin/queries.ts`). Bell is a disabled placeholder at `AdminHeader.tsx:41–51`.
6. ✅ `AdminRole = 'super_admin' | 'admin' | 'support' | 'read_only'` matches.
7. ✅ All admin lookups already filter `revoked_at IS NULL`.

**Deviation from brief:** `src/routes/admin.index.tsx` is not a placeholder render — it's a `beforeLoad` redirect to `/admin/users`. B.5 will replace that file with a real dashboard route; the redirect goes away.

## Execution slices (will ship in this order)

### Slice 1 — DB foundation (one migration)
`db/migrations/20260627000000_brief_ii_phase_b_health_notifications.sql` containing:
- B.1.1 `admin_notifications` + `admin_notification_reads` (with `digest_sent_at` column folded in per B.1.5)
- B.1.3 RPCs: `raise_admin_notification`, `resolve_admin_notification_by_dedup`, `admin_list_notifications`, `admin_mark_notifications_read`
- B.2.1 `health_checks` + `health_check_runs`
- B.4.1 `admin_health_overview`, `admin_health_failures`
- B.4.3 `admin_forecast_volume` — JSON path for Perplexity tokens left as `COALESCE(...,0)` with the actual column verified against `prediction_inputs` before writing (open question 3 flagged for Ben if path is ambiguous)
- B.5.1 `admin_dashboard_summary`
- All varchar/enum returns cast `::text` to avoid Postgres 42804
- Grants per `<public-schema-grants>` rule

### Slice 2 — Seed + cron migrations
- `20260627010000_brief_ii_phase_b_seed_health_checks.sql` — 14 services + `api_sports` (15th, `enabled=false`) per B.3 table
- `20260627020000_brief_ii_phase_b_health_cron.sql` — `cron_health_check()` + `prophiq_health_check` every 5 min; `cron_notification_digest()` + `prophiq_notification_digest` every 30 min

### Slice 3 — Edge functions
- `supabase/functions/health-check/index.ts` + `probes/` directory (one module per service). `withTimeout(5000)`, single `health_check_runs` row per probe, dedup'd notification raise/resolve transitions, 14-day GC. Accepts `{keys?: string[]}` for manual retry. `ALLOW_LIVE_PROBES` flag gates paid/rate-limited probes; `alpha_vantage` defaults to `skipped`.
- `supabase/functions/notification-digest/index.ts` — query unresolved warning/critical where `digest_sent_at IS NULL`, send single Resend email to all active admin emails, stamp `digest_sent_at`. Skip if empty.

### Slice 4 — Frontend lib
- `src/lib/admin/notifications.ts` — typed wrappers for the two notification RPCs
- `src/lib/admin/health.ts` — typed wrappers for `admin_health_overview`, `admin_health_failures`, `admin_forecast_volume`, plus `triggerHealthRetry(key)` invoking the edge fn

### Slice 5 — Admin shell + bell
- `AdminHeader.tsx`: replace disabled bell with live one. `useQuery(['admin','notifications'], refetchInterval: 60_000)`. Dropdown panel reusing the existing click-outside `useRef`. Severity dot colors per brief. "Mark all read" button. Opening does not auto-mark; explicit action or row click does.
- `AdminSidebar.tsx`: bg → `var(--bg)`; remove `comingSoon` from "Dashboard" → `/admin` and "System health" → `/admin/health`; add collapse toggle (component state in `admin.tsx`, default collapsed below `md`); collapsed rail `w-14` with first letter / glyph.
- `admin.tsx`: holds `collapsed` state, passes to sidebar.

### Slice 6 — `/admin/health` (new route)
`src/routes/admin.health.tsx`: status grid grouped by category (critical first), P50/P95, success-rate, last-checked, retry button gated to `super_admin`/`admin`; forecast-volume bars (last 7d); failures table. `useQuery(['admin','health'], refetchInterval: 30_000)`. Manual retry calls `log_admin_action('health_manual_retry', ...)`.

### Slice 7 — `/admin` dashboard
Replace redirect-only `admin.index.tsx` with: 5 tiles + health strip + red banner (when `unresolved_critical > 0 || health.down > 0`) + recent failures (10). `useQuery(['admin','dashboard'], refetchInterval: 60_000)`. "Est. MRR" tile footnoted as catalog-based estimate.

## Verification per slice
- Slice 1–2: `bun run build` (migrations are SQL; the build catches TS issues from generated types if regenerated, but the brief explicitly does not regenerate). Quick `psql -f` dry-run not available locally — relying on careful SQL review.
- Slice 3: build + visual code review (edge fns aren't bundled by Vite).
- Slices 4–7: `bun run build` after each.
- Final acceptance criteria (1–9 from brief) cannot all be verified without `supabase db push` + `functions deploy` — those are Ben's deploy steps. I'll flag any acceptance item that requires post-deploy testing.

## Out of scope (per brief)
- `~flock.js` 500 (host-injected, not app code)
- Full LLM cost attribution (Phase 7.D)
- True Stripe-sourced MRR (Phase 7.D)
- `usage_log` reference in architecture doc §13

## Open questions (will flag inline; not blocking)
1. `API_SPORTS_KEY` — included as 15th entry, `enabled=false`, per brief.
2. Digest cadence — 30 min per brief default.
3. Perplexity token JSON path — will read `prediction_inputs` columns at write time and adjust; if ambiguous, will leave the column returning 0 with a `TODO` comment rather than guess.

Ready to ship slice 1 on approval.
