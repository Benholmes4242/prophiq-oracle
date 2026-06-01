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

## Why migrations live under `db/migrations/`, not `supabase/migrations/`

The Lovable agent is sandboxed away from `supabase/migrations/` (that path is
reserved for Lovable Cloud's managed migrations, which we are NOT using).
All schema SQL is authored under `db/migrations/` instead. Before running
`supabase db push` for the first time on a new clone, mirror it:

```bash
mkdir -p supabase/migrations
cp db/migrations/*.sql supabase/migrations/
```

Or symlink (Linux/macOS):
```bash
mkdir -p supabase
ln -s ../db/migrations supabase/migrations
```

The `supabase/migrations/` path itself is gitignored to avoid confusion.

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
mkdir -p supabase/migrations
cp -n db/migrations/*.sql supabase/migrations/   # first time only / when new migrations land
supabase db push
```

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

Cron is one timestamped migration: `db/migrations/20260601010000_cron.sql`.
It enables `pg_cron` + `pg_net`, defines three helper functions, and
schedules three jobs that POST to the deployed edge functions.

**One-time operator setup** — store these in Supabase Vault via
Dashboard → Project Settings → Vault BEFORE deploying the cron migration
(otherwise the helpers raise a clear error when fired):

- `prophiq_supabase_url` — your project URL (`https://rkktqrqsmoumnklvsahg.supabase.co`)
- `prophiq_service_role_key` — the service-role key

Then push the migration the usual way (`supabase db push`).

**Confirm jobs are scheduled:**
```sql
SELECT jobname, schedule, active FROM cron.job
WHERE jobname LIKE 'prophiq_%' ORDER BY jobname;
```
Expect three rows, all `active = true`:
- `prophiq_discover_events`        — `0 */4 * * *`
- `prophiq_generate_predictions`   — `5 * * * *`
- `prophiq_score_predictions`      — `15 * * * *`

**Fire each job manually** (smoke test without waiting for the schedule):
```sql
-- discover-events (single async POST)
SELECT public.cron_discover_events();

-- generate-prediction (returns one row per dispatched (event, mode) pair)
SELECT * FROM public.cron_generate_pending_predictions(50);

-- score-prediction (same shape)
SELECT * FROM public.cron_score_pending_events(100);

-- inspect the resulting net.http requests + responses (newest first)
SELECT id, status_code, content
FROM net._http_response
ORDER BY id DESC
LIMIT 20;

-- inspect cron run history
SELECT jobid, runid, start_time, status, return_message
FROM cron.job_run_details
WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'prophiq_%')
ORDER BY start_time DESC LIMIT 20;
```

**Disable a misbehaving job** (keeps the job row + history, just stops it firing):
```sql
UPDATE cron.job SET active = false WHERE jobname = 'prophiq_generate_predictions';
-- re-enable
UPDATE cron.job SET active = true  WHERE jobname = 'prophiq_generate_predictions';
-- remove entirely
SELECT cron.unschedule('prophiq_generate_predictions');
```

For `events.mode = 'both'`, the generate + score loops dispatch BOTH the
`prediction` and `odds` variants per event automatically.

## Notes

- Migrations are timestamped; never edit a migration that has already been pushed.
- If you need to roll back, write a new migration with the reverse change.
- Event detail pages (`/$domain/events/$slug`) render server-side and emit
  JSON-LD `Event` structured data — keep that intact when editing route files.
