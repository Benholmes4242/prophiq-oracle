// Brief FF v2 / Phase A — Backfill sub-questions for existing parent events.
//
// CALLABLE ONLY. Not auto-invoked. Run manually after verifying that
// newly-discovered events are getting sub-questions generated correctly.
//
// Usage (from project root, with Deno + service-role env wired):
//   deno run --allow-env --allow-net db/scripts/backfill_sub_questions.ts
//
// Walks parents that (a) have metadata.sub_category set, (b) are not yet
// resolved, and (c) have no children, then runs generateSubQuestions on
// each one. Idempotent — re-runs are safe.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { generateSubQuestions } from "../../supabase/functions/_shared/subQuestions.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  Deno.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const { data: parents, error } = await supabase
  .from("events")
  .select("id, domain, slug, title, starts_at, resolves_at, mode, metadata")
  .is("parent_event_id", null)
  .eq("status", "scheduled")
  .not("metadata->>sub_category", "is", null);

if (error) {
  console.error("query failed:", error.message);
  Deno.exit(1);
}

console.log(`Found ${parents?.length ?? 0} parent candidates.`);

let totalInserted = 0;
let totalSkipped = 0;
const allErrors: string[] = [];

for (const p of parents ?? []) {
  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("parent_event_id", p.id);
  if ((count ?? 0) > 0) {
    totalSkipped++;
    continue;
  }
  const r = await generateSubQuestions(supabase, p as Parameters<typeof generateSubQuestions>[1]);
  totalInserted += r.inserted;
  totalSkipped += r.skipped;
  if (r.errors.length) allErrors.push(`[${p.slug}] ${r.errors.join("; ")}`);
  console.log(`[${p.slug}] inserted=${r.inserted} skipped=${r.skipped} errors=${r.errors.length}`);
}

console.log(`\nDone. inserted=${totalInserted} skipped=${totalSkipped} errors=${allErrors.length}`);
if (allErrors.length) console.log(allErrors.join("\n"));
