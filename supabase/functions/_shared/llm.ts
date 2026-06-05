// Multi-LLM client. Each provider returns a ModelRanking that consensusEngine
// can consume directly. Adapters handle their own JSON-extraction quirks.
//
// Environment variables (read at call time, never at module scope):
//   ANTHROPIC_API_KEY  -> Claude
//   OPENAI_API_KEY     -> GPT
//   GOOGLE_API_KEY     -> Gemini

import type { ModelPickDetail, ModelRanking, ModelUsage } from "./consensusEngine.ts";

/**
 * Best-effort usage extractor. NEVER throws — any failure returns undefined
 * and the ranking is returned without usage info. Cost-logging is opportunistic
 * and must never break or block prediction generation.
 */
function safeExtractUsage(extract: () => ModelUsage | undefined): ModelUsage | undefined {
  try {
    const u = extract();
    if (!u) return undefined;
    const out: ModelUsage = {};
    if (typeof u.input_tokens === "number" && Number.isFinite(u.input_tokens)) {
      out.input_tokens = Math.max(0, Math.floor(u.input_tokens));
    }
    if (typeof u.output_tokens === "number" && Number.isFinite(u.output_tokens)) {
      out.output_tokens = Math.max(0, Math.floor(u.output_tokens));
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

export interface LlmInvokeInput {
  prompt: string;
  /** Outcomes the model must rank, in canonical order. */
  outcomes: Array<{ id: string; label: string }>;
  /** Per-call temperature override. */
  temperature?: number;
}

export type LlmCaller = (input: LlmInvokeInput) => Promise<ModelRanking>;

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

/** Suffix appended to every prompt to enforce a parseable response. */
function jsonSuffix(outcomes: Array<{ id: string; label: string }>): string {
  const labels = outcomes.map((o, i) => `${i + 1}. ${o.label} [id=${o.id}]`).join("\n");
  return `\n\nOutcomes to rank (use the EXACT outcome_id values):
${labels}

Return STRICT JSON only — no prose, no markdown fences. Schema:
{
  "rankings": [
    {
      "outcome_id": "<id>",
      "rank": 1,
      "probability": 0.0,
      "fit_score": 0.0,
      "reasons": ["short reason", "..."]
    }
  ],
  "rationale": "one-paragraph summary"
}
Rank EVERY outcome exactly once, starting at rank 1.`;
}

/**
 * Model IDs are constants so they're easy to find and rotate when providers age them out.
 * Last rotated: 2026-06-01 (Claude 3.5 Sonnet Oct 2024 and Gemini 1.5 Flash both retired).
 */
export const MODEL_IDS = {
  claude: "claude-sonnet-4-5",
  gpt: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
} as const;

interface RawRanking {
  outcome_id?: string;
  rank?: number;
  probability?: number;
  fit_score?: number;
  reasons?: string[];
}

/** Convert a raw LLM response string into a ModelRanking. Tolerant of extras. */
export function parseLlmResponse(model: string, content: string, allowedIds: string[]): ModelRanking {
  const allowed = new Set(allowedIds);
  let parsed: { rankings?: RawRanking[]; rationale?: string } | null = null;
  // try fenced
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], content.match(/\{[\s\S]*\}/)?.[0], content];
  for (const c of candidates) {
    if (!c) continue;
    try { parsed = JSON.parse(c.trim()); if (parsed) break; } catch { /* try next */ }
  }
  if (!parsed || !Array.isArray(parsed.rankings)) {
    return { model, ranked_outcome_ids: [], error: "unparseable response" };
  }

  // Sort by rank, dedupe, filter to allowed ids
  const seen = new Set<string>();
  const rows = parsed.rankings
    .filter((r): r is RawRanking & { outcome_id: string; rank: number } =>
      typeof r?.outcome_id === "string" && typeof r?.rank === "number" && allowed.has(r.outcome_id))
    .sort((a, b) => a.rank - b.rank)
    .filter((r) => { if (seen.has(r.outcome_id)) return false; seen.add(r.outcome_id); return true; });

  const ranked_outcome_ids = rows.map((r) => r.outcome_id);
  const details: Record<string, ModelPickDetail> = {};
  rows.forEach((r, idx) => {
    details[r.outcome_id] = {
      rank: idx + 1,
      probability: typeof r.probability === "number" ? normaliseProbability(r.probability) : undefined,
      fitScore: typeof r.fit_score === "number" ? normaliseFitScore(r.fit_score) : undefined,
      reasons: Array.isArray(r.reasons) ? r.reasons.filter((x) => typeof x === "string").slice(0, 3) : undefined,
    };
  });

  if (ranked_outcome_ids.length === 0) {
    return { model, ranked_outcome_ids: [], error: "no valid outcome ids in response" };
  }

  return {
    model,
    ranked_outcome_ids,
    details,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : undefined,
  };
}

function normaliseProbability(x: number): number {
  // accept 0-1 OR 0-100; consensus engine treats probability as 0-100.
  if (x <= 1) return Math.round(x * 1000) / 10;
  return Math.max(0, Math.min(100, x));
}
function normaliseFitScore(x: number): number {
  if (x <= 1) return Math.round(x * 100);
  return Math.max(0, Math.min(100, Math.round(x)));
}

// ============================================================
// Claude (Anthropic)
// ============================================================
export const callClaude: LlmCaller = async ({ prompt, outcomes, temperature }) => {
  const key = readEnv("ANTHROPIC_API_KEY");
  if (!key) return { model: "claude", ranked_outcome_ids: [], error: "ANTHROPIC_API_KEY missing" };
  const t0 = Date.now();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_IDS.claude,
        max_tokens: 2000,
        temperature: temperature ?? 0.2,
        messages: [{ role: "user", content: prompt + jsonSuffix(outcomes) }],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        model: "claude", ranked_outcome_ids: [],
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        latency_ms: Date.now() - t0,
      };
    }
    const json = await res.json() as {
      content?: Array<{ text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = json.content?.map((c) => c.text ?? "").join("") ?? "";
    const ranking = parseLlmResponse("claude", text, outcomes.map((o) => o.id));
    ranking.latency_ms = Date.now() - t0;
    ranking.usage = safeExtractUsage(() => ({
      input_tokens: json.usage?.input_tokens,
      output_tokens: json.usage?.output_tokens,
    }));
    return ranking;
  } catch (err) {
    return {
      model: "claude", ranked_outcome_ids: [],
      error: (err as Error).message,
      latency_ms: Date.now() - t0,
    };
  }
};

// ============================================================
// GPT (OpenAI)
// ============================================================
export const callGPT: LlmCaller = async ({ prompt, outcomes, temperature }) => {
  const key = readEnv("OPENAI_API_KEY");
  if (!key) return { model: "gpt", ranked_outcome_ids: [], error: "OPENAI_API_KEY missing" };
  const t0 = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_IDS.gpt,
        temperature: temperature ?? 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a careful analyst. Always return strict JSON matching the requested schema." },
          { role: "user", content: prompt + jsonSuffix(outcomes) },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        model: "gpt", ranked_outcome_ids: [],
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        latency_ms: Date.now() - t0,
      };
    }
    const json = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    const ranking = parseLlmResponse("gpt", text, outcomes.map((o) => o.id));
    ranking.latency_ms = Date.now() - t0;
    ranking.usage = safeExtractUsage(() => ({
      input_tokens: json.usage?.prompt_tokens,
      output_tokens: json.usage?.completion_tokens,
    }));
    return ranking;
  } catch (err) {
    return {
      model: "gpt", ranked_outcome_ids: [],
      error: (err as Error).message,
      latency_ms: Date.now() - t0,
    };
  }
};

// ============================================================
// Gemini (Google)
// ============================================================
export const callGemini: LlmCaller = async ({ prompt, outcomes, temperature }) => {
  const key = readEnv("GOOGLE_API_KEY");
  if (!key) return { model: "gemini", ranked_outcome_ids: [], error: "GOOGLE_API_KEY missing" };
  const t0 = Date.now();
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_IDS.gemini}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt + jsonSuffix(outcomes) }] }],
        generationConfig: {
          temperature: temperature ?? 0.2,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        model: "gemini", ranked_outcome_ids: [],
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        latency_ms: Date.now() - t0,
      };
    }
    const json = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const ranking = parseLlmResponse("gemini", text, outcomes.map((o) => o.id));
    ranking.latency_ms = Date.now() - t0;
    ranking.usage = safeExtractUsage(() => ({
      input_tokens: json.usageMetadata?.promptTokenCount,
      output_tokens: json.usageMetadata?.candidatesTokenCount,
    }));
    return ranking;
  } catch (err) {
    return {
      model: "gemini", ranked_outcome_ids: [],
      error: (err as Error).message,
      latency_ms: Date.now() - t0,
    };
  }
};

export const ALL_LLM_CALLERS: LlmCaller[] = [callClaude, callGPT, callGemini];
