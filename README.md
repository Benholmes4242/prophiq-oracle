# Prophiq — Deployment Guide

External Supabase project: `prophiq` (org `mbf`), ref `rkktqrqsmoumnklvsahg`.
This repo does **not** use Lovable Cloud. All Postgres + Edge Function deploys
are run manually with the Supabase CLI from your machine.

## Prerequisites

- Supabase CLI **>= 1.200.0** (latest is fine). Install: <https://supabase.com/docs/guides/cli>
- Logged in: `supabase login`
- Project linked once per machine:
  ```bash
  supabase link --project-ref rkktqrqsmoumnklvsahg
  ```

## Environment variables

### Frontend — `.env.local` (already created locally, gitignored)
```
VITE_SUPABASE_URL=https://rkktqrqsmoumnklvsahg.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key — paste yourself>
```

### Edge Function secrets (already configured in Supabase dashboard)
Available via `Deno.env.get(...)` inside any deployed function:
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `PERPLEXITY_API_KEY`
- `IP_HASH_SALT`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto)

Do **not** add these to `.env.local`. They live only in Supabase.

## Deploy order

Run each step from the repo root. Verify the previous step before moving on.

### 1. Schema (Phase 1)
```bash
supabase db push
```
Pushes everything under `supabase/migrations/` to the linked project.

**Verify:** in Supabase SQL editor:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```
Expect: `chat_messages`, `chat_threads`, `event_outcomes`, `event_resolutions`,
`events`, `prediction_accuracy`, `predictions`, `submission_rate_limits`.

Then refresh `/healthcheck` in the preview — Row 2 should flip to **OK**
(`events` table reachable, row count 0).

### 2. Edge Functions (Phase 4) — deploy after Phases 2–3 land
```bash
supabase functions deploy discover-events
supabase functions deploy generate-prediction
supabase functions deploy score-prediction
supabase functions deploy submit-question
supabase functions deploy chat-message
```
Smoke test (replace `<ANON_KEY>`):
```bash
curl -i -X POST https://rkktqrqsmoumnklvsahg.supabase.co/functions/v1/discover-events \
  -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json"
```

### 3. Cron (Phase 5)
Open `supabase/cron.sql` in the Supabase SQL editor and run it as one transaction.
Verify:
```sql
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
```
All scheduled jobs should be `active = true`.

## Notes

- Migrations are timestamped; never edit a migration that has already been pushed.
- If you need to roll back, write a new migration with the reverse change.
- Event detail pages (`/$domain/events/$slug`) render server-side and emit
  JSON-LD `Event` structured data — keep that intact when editing route files.
