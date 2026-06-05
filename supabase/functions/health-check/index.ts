// health-check edge function.
//
// Probes each enabled service in public.health_checks with a hard 5s timeout,
// writes one health_check_runs row per probe, transitions admin_notifications
// state via raise_admin_notification / resolve_admin_notification_by_dedup,
// and GC's runs older than 14 days.
//
// Request body: { keys?: string[] }  // empty = all enabled
// Probes are cheap liveness checks - NEVER paid completions. The
// ALLOW_LIVE_PROBES env flag gates a few rate-limited probes (alpha_vantage)
// which otherwise return status='skipped'.

import { handleCorsPreflight, jsonResponse, errorResponse } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabaseClient.ts";

const PROBE_TIMEOUT_MS = 5_000;

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

const ALLOW_LIVE_PROBES = (readEnv("ALLOW_LIVE_PROBES") ?? "") === "1";

type Status = "ok" | "degraded" | "down" | "skipped";
interface ProbeResult { status: Status; latency_ms: number | null; detail: string | null }

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let to: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    to = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (to) clearTimeout(to);
  }
}

// timed() wraps a probe so every probe ends up with a latency number and
// turns any thrown error into a `down` result.
async function timed(
  fn: () => Promise<{ status: Status; detail: string | null }>,
): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const res = await withTimeout(fn(), PROBE_TIMEOUT_MS, "probe");
    return { status: res.status, latency_ms: Date.now() - start, detail: res.detail };
  } catch (err) {
    return {
      status: "down",
      latency_ms: Date.now() - start,
      detail: (err as Error).message?.slice(0, 240) ?? "unknown error",
    };
  }
}

// A small GET that treats 2xx as ok, anything else as down.
async function simpleGet(url: string, headers: Record<string, string> = {}): Promise<{ status: Status; detail: string | null }> {
  const res = await fetch(url, { method: "GET", headers });
  if (res.ok) return { status: "ok", detail: `HTTP ${res.status}` };
  // Treat 401/403 as down (key broken). 429 = degraded (rate-limited but alive).
  if (res.status === 429) return { status: "degraded", detail: "HTTP 429 rate limited" };
  return { status: "down", detail: `HTTP ${res.status}` };
}

function keyPresenceSkip(name: string): { status: Status; detail: string | null } {
  return { status: "skipped", detail: `key present (${name}), live probe disabled` };
}

// ============================================================
// Probes
// ============================================================
const probes: Record<string, () => Promise<{ status: Status; detail: string | null }>> = {
  anthropic: async () => {
    const key = readEnv("ANTHROPIC_API_KEY");
    if (!key) return { status: "down", detail: "ANTHROPIC_API_KEY missing" };
    return simpleGet("https://api.anthropic.com/v1/models", {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    });
  },

  openai: async () => {
    const key = readEnv("OPENAI_API_KEY");
    if (!key) return { status: "down", detail: "OPENAI_API_KEY missing" };
    return simpleGet("https://api.openai.com/v1/models", {
      Authorization: `Bearer ${key}`,
    });
  },

  google: async () => {
    const key = readEnv("GOOGLE_API_KEY");
    if (!key) return { status: "down", detail: "GOOGLE_API_KEY missing" };
    return simpleGet(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
  },

  perplexity: async () => {
    const key = readEnv("PERPLEXITY_API_KEY");
    if (!key) return { status: "down", detail: "PERPLEXITY_API_KEY missing" };
    if (!ALLOW_LIVE_PROBES) return keyPresenceSkip("PERPLEXITY_API_KEY");
    // Live probe: hit a cheap models endpoint. Falls back to key-presence on 404.
    const res = await fetch("https://api.perplexity.ai/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 404) return { status: "ok", detail: "models endpoint 404 (alive)" };
    if (res.ok) return { status: "ok", detail: `HTTP ${res.status}` };
    if (res.status === 429) return { status: "degraded", detail: "HTTP 429 rate limited" };
    return { status: "down", detail: `HTTP ${res.status}` };
  },

  fred: async () => {
    const key = readEnv("FRED_API_KEY");
    if (!key) return { status: "down", detail: "FRED_API_KEY missing" };
    return simpleGet(`https://api.stlouisfed.org/fred/series?series_id=GDP&api_key=${encodeURIComponent(key)}&file_type=json`);
  },

  alpha_vantage: async () => {
    const key = readEnv("ALPHA_VANTAGE_API_KEY");
    if (!key) return { status: "down", detail: "ALPHA_VANTAGE_API_KEY missing" };
    // Free tier: 25/day. Default to skipped to avoid burning quota every 5 min.
    if (!ALLOW_LIVE_PROBES) {
      return { status: "skipped", detail: "key present, rate-limited tier, not probed" };
    }
    return simpleGet(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=${encodeURIComponent(key)}`);
  },

  polymarket: async () => {
    return simpleGet("https://gamma-api.polymarket.com/markets?limit=1");
  },

  kalshi: async () => {
    return simpleGet("https://api.elections.kalshi.com/trade-api/v2/markets?limit=1");
  },

  football_data: async () => {
    const key = readEnv("FOOTBALL_DATA_API_KEY");
    if (!key) return { status: "down", detail: "FOOTBALL_DATA_API_KEY missing" };
    return simpleGet("https://api.football-data.org/v4/competitions", {
      "X-Auth-Token": key,
    });
  },

  thesportsdb: async () => {
    const key = readEnv("THESPORTSDB_API_KEY");
    if (!key) return { status: "down", detail: "THESPORTSDB_API_KEY missing" };
    return simpleGet(`https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}/all_leagues.php`);
  },

  tmdb: async () => {
    const key = readEnv("TMDB_API_KEY");
    if (!key) return { status: "down", detail: "TMDB_API_KEY missing" };
    return simpleGet(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`);
  },

  spotify: async () => {
    const id = readEnv("SPOTIFY_CLIENT_ID");
    const secret = readEnv("SPOTIFY_CLIENT_SECRET");
    if (!id || !secret) return { status: "down", detail: "SPOTIFY_CLIENT_ID/SECRET missing" };
    // client-credentials token. Cheap, no per-user data.
    const basic = btoa(`${id}:${secret}`);
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (res.ok) return { status: "ok", detail: `HTTP ${res.status}` };
    if (res.status === 429) return { status: "degraded", detail: "HTTP 429 rate limited" };
    return { status: "down", detail: `token HTTP ${res.status}` };
  },

  stripe: async () => {
    const key = readEnv("STRIPE_SECRET_KEY");
    if (!key) return { status: "down", detail: "STRIPE_SECRET_KEY missing" };
    return simpleGet("https://api.stripe.com/v1/balance", {
      Authorization: `Bearer ${key}`,
    });
  },

  resend: async () => {
    const key = readEnv("RESEND_API_KEY");
    if (!key) return { status: "down", detail: "RESEND_API_KEY missing" };
    return simpleGet("https://api.resend.com/domains", {
      Authorization: `Bearer ${key}`,
    });
  },

  supabase_db: async () => {
    const sb = getServiceClient();
    const { error } = await sb.from("health_checks").select("key", { count: "exact", head: true });
    if (error) return { status: "down", detail: error.message.slice(0, 240) };
    return { status: "ok", detail: "select 1" };
  },

  api_sports: async () => {
    // Legacy entry (enabled=false in seed). Never actually invoked unless
    // someone flips enabled=true. Lightweight key-presence only.
    const key = readEnv("API_SPORTS_KEY");
    if (!key) return { status: "down", detail: "API_SPORTS_KEY missing" };
    return { status: "skipped", detail: "legacy source, not probed" };
  },
};

// ============================================================
// Handler
// ============================================================

interface CheckRow {
  key: string;
  enabled: boolean;
  critical: boolean;
  expected_latency_ms: number | null;
}

interface ProbeOutcome extends ProbeResult { key: string; critical: boolean }

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  let body: { keys?: string[] } = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { body = {}; }
  }

  const sb = getServiceClient();

  // Load registry
  let query = sb.from("health_checks").select("key,enabled,critical,expected_latency_ms");
  if (body.keys && body.keys.length > 0) {
    query = query.in("key", body.keys);
  } else {
    query = query.eq("enabled", true);
  }
  const { data: checks, error: regErr } = await query;
  if (regErr) return errorResponse(`registry load failed: ${regErr.message}`, 500);
  const rows = (checks ?? []) as CheckRow[];

  // Get the prior status per key so we know transitions.
  const priorStatus = new Map<string, Status>();
  if (rows.length > 0) {
    const keys = rows.map((r) => r.key);
    const { data: prior } = await sb
      .from("health_check_runs")
      .select("check_key,status,checked_at")
      .in("check_key", keys)
      .order("checked_at", { ascending: false })
      .limit(200);
    for (const row of (prior ?? []) as { check_key: string; status: Status }[]) {
      if (!priorStatus.has(row.check_key)) priorStatus.set(row.check_key, row.status);
    }
  }

  // Run all probes in parallel.
  const outcomes: ProbeOutcome[] = await Promise.all(
    rows.map(async (r): Promise<ProbeOutcome> => {
      const probe = probes[r.key];
      if (!probe) {
        return { key: r.key, critical: r.critical, status: "skipped", latency_ms: 0, detail: "no probe implementation" };
      }
      const res = await timed(probe);
      // Degraded: succeeded but >2x expected_latency_ms.
      if (res.status === "ok" && r.expected_latency_ms && res.latency_ms && res.latency_ms > r.expected_latency_ms * 2) {
        return { ...res, key: r.key, critical: r.critical, status: "degraded", detail: `slow: ${res.latency_ms}ms (expected ${r.expected_latency_ms})` };
      }
      return { ...res, key: r.key, critical: r.critical };
    }),
  );

  // Persist runs.
  const runsPayload = outcomes.map((o) => ({
    check_key: o.key,
    status: o.status,
    latency_ms: o.latency_ms,
    detail: o.detail,
  }));
  if (runsPayload.length > 0) {
    const { error: insErr } = await sb.from("health_check_runs").insert(runsPayload);
    if (insErr) console.warn(`[health-check] insert runs failed: ${insErr.message}`);
  }

  // Transitions: raise / resolve notifications.
  for (const o of outcomes) {
    const dedup = `health:${o.key}:down`;
    const prev = priorStatus.get(o.key);
    const isDown = o.status === "down" || o.status === "degraded";
    const wasDown = prev === "down" || prev === "degraded";

    if (isDown && !wasDown) {
      // New incident. Severity by criticality.
      await sb.rpc("raise_admin_notification", {
        p_severity: o.critical ? "critical" : "warning",
        p_category: "health",
        p_title: `${o.key} is ${o.status}`,
        p_body: o.detail ?? null,
        p_source: "health-check",
        p_target_url: "/admin/health",
        p_dedup_key: dedup,
        p_metadata: { key: o.key, latency_ms: o.latency_ms },
      });
    } else if (!isDown && wasDown && o.status === "ok") {
      await sb.rpc("resolve_admin_notification_by_dedup", { p_dedup_key: dedup });
    }
  }

  // GC: drop runs older than 14 days. Cheap, indexed.
  await sb.from("health_check_runs")
    .delete()
    .lt("checked_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString());

  const summary = {
    checked: outcomes.length,
    ok:       outcomes.filter((o) => o.status === "ok").length,
    degraded: outcomes.filter((o) => o.status === "degraded").length,
    down:     outcomes.filter((o) => o.status === "down").length,
    skipped:  outcomes.filter((o) => o.status === "skipped").length,
    results:  outcomes,
  };
  return jsonResponse(summary);
});
