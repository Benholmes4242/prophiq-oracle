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
import { hasPlaceholderOutcomes } from "../_shared/outcomeQuality.ts";
import { canonicaliseTitle } from "../_shared/domains/_util.ts";

registerAllDomains();

// Bug 3 secondary gate: discovery-side coerce already rejects past events,
// but a discover() adapter could in principle hand us a stale one. Belt and
// braces.
const STALE_EVENT_GRACE_MS = 60 * 60 * 1000;

// Fix 1 (near-duplicate guard): when scanning for an existing event that
// represents the same real-world fixture as the one we are about to insert,
// look ±36h around starts_at. Wider than a calendar day so an event that
// crosses midnight UTC (frequent for US sport / overnight markets data) is
// still matched.
const NEAR_DUPLICATE_WINDOW_MS = 36 * 60 * 60 * 1000;

interface DiscoverBody { domains?: string[]; source?: string; manual?: boolean; }

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

  const isCronRun = body.source === "cron";
  const startedAt = Date.now();

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
    console.log(`[discover-events:${id}] discovered ${events.length} events; metadata keys:`, events.slice(0, 3).map((ev) => Object.keys(ev.metadata ?? {})));
    for (const ev of events) {
      try {
        // Bug 4 secondary gate: never persist an event whose outcomes
        // contain positional placeholders. Adapter-side coerce already
        // enforces this, but enforce at the write boundary too so a future
        // non-LLM path (sync, manual insert) cannot bypass it.
        if (hasPlaceholderOutcomes(ev.outcomes.map((o) => o.label))) {
          res.skipped++;
          console.warn(
            `[discover-events:${id}] skipped event ${ev.slug}: placeholder outcomes`,
          );
          continue;
        }
        // Bug 3 secondary gate: skip past events.
        if (new Date(ev.starts_at).getTime() < Date.now() - STALE_EVENT_GRACE_MS) {
          res.skipped++;
          console.warn(
            `[discover-events:${id}] skipped event ${ev.slug}: starts_at in the past (${ev.starts_at})`,
          );
          continue;
        }

        // Fix 1 (pre-insert near-duplicate guard): the hardened canonical
        // hash in stableEventId() already collapses most title-variance
        // duplicates. This guard catches the residue — typo'd titles,
        // missing-token variants, or events whose canonical hash happened
        // to differ by one token. We look for any existing TOP-LEVEL event
        // in the same domain within ±36h of starts_at whose title shares
        // the same canonical token set, then re-point the upsert at it.
        const evCanon = canonicaliseTitle(ev.title);
        if (evCanon.length > 0) {
          const startMs = new Date(ev.starts_at).getTime();
          const windowFrom = new Date(startMs - NEAR_DUPLICATE_WINDOW_MS).toISOString();
          const windowTo = new Date(startMs + NEAR_DUPLICATE_WINDOW_MS).toISOString();
          const { data: nearby } = await supabase
            .from("events")
            .select("id, external_id, title")
            .eq("domain", id)
            .is("parent_event_id", null)
            .gte("starts_at", windowFrom)
            .lte("starts_at", windowTo)
            .limit(50);
          if (nearby && nearby.length > 0) {
            const match = nearby.find((row) => {
              if (row.external_id === ev.external_id) return true;
              return canonicaliseTitle(row.title ?? "") === evCanon;
            });
            if (match && match.external_id !== ev.external_id) {
              console.log(
                `[discover-events:${id}] near-duplicate of existing event ${match.id} (\"${match.title}\"); reusing external_id`,
              );
              ev.external_id = match.external_id;
            }
          }
        }

        const eventMetadata = ev.metadata ?? null;
        console.log(`[discover-events:${id}] upserting event:`, JSON.stringify({ slug: ev.slug, metadata: eventMetadata }));
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
            metadata: eventMetadata,
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

        // Phase A: generate binary sub-questions from templates (no-op when
        // metadata.sub_category is absent). Best-effort; do not fail parent.
        try {
          const sq = await generateSubQuestions(supabase, {
            id: upserted!.id,
            domain: id,
            slug: ev.slug,
            title: ev.title,
            starts_at: ev.starts_at,
            resolves_at: ev.resolves_at,
            mode: ev.mode,
            metadata: eventMetadata,
          });
          if (sq.errors.length) res.errors.push(`sub-questions: ${sq.errors.join("; ")}`);
        } catch (sqErr) {
          res.errors.push(`sub-questions error: ${(sqErr as Error).message}`);
        }
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

  // Best-effort cron self-report. Never blocks the response.
  if (isCronRun) {
    try {
      await supabase.rpc("log_cron_run", {
        p_job_name: "prophiq_discover_events",
        p_status: summary.total_errors > 0 ? "partial" : "succeeded",
        p_duration_ms: Date.now() - startedAt,
        p_items_processed: summary.total_inserted + summary.total_updated,
        p_detail: {
          inserted: summary.total_inserted,
          updated: summary.total_updated,
          errors: summary.total_errors,
          domains: summary.domains.map((d) => ({
            domain: d.domain, inserted: d.inserted, updated: d.updated, errors: d.errors.length,
          })),
          manual: !!body.manual,
        },
        p_error_message: null,
      });
    } catch (e) {
      console.warn(`[discover-events] log_cron_run failed: ${(e as Error).message}`);
    }
  }

  return jsonResponse(summary);
});
