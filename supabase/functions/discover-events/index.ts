// POST /functions/v1/discover-events
// Optional body: { domains?: string[] }  // default = all registered domains
// Auth: service-role (caller-side). Idempotent on (domain, external_id).
//
// Runs each domain adapter's discover() in parallel, upserts events +
// outcomes. Bad items are skipped (adapter-side); a discover() failure for
// one domain does not block the others.

import { registerAllDomains } from "../_shared/domains/index.ts";
import { listDomains, getDomain } from "../_shared/domains/registry.ts";
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";
import { generateSubQuestions } from "../_shared/subQuestions.ts";

registerAllDomains();

interface DiscoverBody { domains?: string[]; }

interface PerDomainResult {
  domain: string;
  attempted: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: DiscoverBody = {};
  try { body = req.headers.get("content-length") === "0" ? {} : (await req.json() as DiscoverBody); } catch { body = {}; }

  const requested = Array.isArray(body.domains) && body.domains.length > 0
    ? body.domains
    : listDomains().map((d) => d.id);

  const supabase = getServiceClient();
  const now = new Date();
  const results: PerDomainResult[] = await Promise.all(requested.map(async (id) => {
    const res: PerDomainResult = { domain: id, attempted: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
    let adapter;
    try { adapter = getDomain(id); } catch (e) { res.errors.push((e as Error).message); return res; }

    let events;
    try { events = await adapter.discover(now); } catch (e) {
      res.errors.push(`discover failed: ${(e as Error).message}`); return res;
    }
    res.attempted = events.length;
    for (const ev of events) {
      try {
        const { data: upserted, error } = await supabase
          .from("events")
          .upsert({
            domain: id,
            external_id: ev.external_id,
            slug: ev.slug,
            title: ev.title,
            description: ev.description ?? null,
            question: ev.question,
            starts_at: ev.starts_at,
            resolves_at: ev.resolves_at,
            status: "scheduled",
            mode: ev.mode,
            source: "discovered",
            moderation_status: "approved",
            metadata: ev.metadata ?? null,
          }, { onConflict: "domain,external_id" })
          .select("id, created_at, updated_at")
          .single();
        if (error) { res.errors.push(`upsert: ${error.message}`); res.skipped++; continue; }
        const isNew = upserted && upserted.created_at === upserted.updated_at;
        if (isNew) res.inserted++; else res.updated++;
        // upsert outcomes (idempotent on event_id+external_id; we use label as external_id when missing)
        const rows = ev.outcomes.map((o) => ({
          event_id: upserted!.id,
          external_id: o.external_id ?? o.label,
          label: o.label,
          metadata: o.metadata ?? null,
        }));
        const { error: oErr } = await supabase.from("event_outcomes").upsert(rows, { onConflict: "event_id,external_id" });
        if (oErr) res.errors.push(`outcomes upsert: ${oErr.message}`);
      } catch (e) {
        res.errors.push(`event error: ${(e as Error).message}`); res.skipped++;
      }
    }
    return res;
  }));

  const summary = {
    ran_at: now.toISOString(),
    domains: results,
    total_inserted: results.reduce((s, r) => s + r.inserted, 0),
    total_updated: results.reduce((s, r) => s + r.updated, 0),
    total_errors: results.reduce((s, r) => s + r.errors.length, 0),
  };
  return jsonResponse(summary);
});
