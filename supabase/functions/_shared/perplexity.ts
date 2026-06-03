// Thin Perplexity client used by domain adapters and the consensus engine for
// grounded research. Reads PERPLEXITY_API_KEY from the edge function env.

export interface PerplexityMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PerplexityOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  searchRecencyFilter?: "day" | "week" | "month" | "year";
  searchDomainFilter?: string[];
  responseFormat?: {
    type: "json_schema";
    json_schema: { schema: Record<string, unknown> };
  };
}

export interface PerplexityResponse {
  content: string;
  citations: string[];
  model: string;
  raw: unknown;
}

const ENDPOINT = "https://api.perplexity.ai/chat/completions";

export async function perplexityChat(
  messages: PerplexityMessage[],
  opts: PerplexityOptions = {},
): Promise<PerplexityResponse> {
  const apiKey = readEnv("PERPLEXITY_API_KEY");
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: opts.model ?? "sonar",
    messages,
    temperature: opts.temperature ?? 0.2,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.searchRecencyFilter) body.search_recency_filter = opts.searchRecencyFilter;
  if (opts.searchDomainFilter) body.search_domain_filter = opts.searchDomainFilter;
  if (opts.responseFormat) body.response_format = opts.responseFormat;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });



  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Perplexity ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
  };

  return {
    content: json.choices?.[0]?.message?.content ?? "",
    citations: json.citations ?? [],
    model: json.model ?? (body.model as string),
    raw: json,
  };
}

function readEnv(name: string): string | undefined {
  // Deno edge functions
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  // Node fallback for tests
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

// --------------------------------------------------------------------------
// Shared research-context helper used by domain adapter gatherResearch()
// implementations. Wraps perplexityChat with a 20s timeout and packages the
// response into a ResearchContext for storage on the prediction row.
// --------------------------------------------------------------------------

import type { ResearchContext } from "./domain.ts";

const DEFAULT_RESEARCH_MODEL = "sonar-pro";
const DEFAULT_RESEARCH_TEMPERATURE = 0.2;
const DEFAULT_RESEARCH_MAX_TOKENS = 800;
const DEFAULT_RESEARCH_RECENCY: "day" | "week" | "month" | "year" = "week";
const DEFAULT_RESEARCH_TIMEOUT_MS = 20_000;

export async function fetchResearchContext(args: {
  systemPrompt: string;
  userPrompt: string;
  researchPromptVersion: string;
  recencyFilter?: "day" | "week" | "month" | "year";
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<ResearchContext> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_RESEARCH_TIMEOUT_MS;

  const response = await Promise.race<PerplexityResponse>([
    perplexityChat(
      [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userPrompt },
      ],
      {
        model: DEFAULT_RESEARCH_MODEL,
        temperature: DEFAULT_RESEARCH_TEMPERATURE,
        maxTokens: args.maxTokens ?? DEFAULT_RESEARCH_MAX_TOKENS,
        searchRecencyFilter: args.recencyFilter ?? DEFAULT_RESEARCH_RECENCY,
      },
    ),
    new Promise<PerplexityResponse>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Perplexity request timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
    ),
  ]);

  const rawAny = response.raw as Record<string, unknown> | null;
  const usage = rawAny && typeof rawAny === "object"
    ? (rawAny["usage"] as Record<string, number> | undefined)
    : undefined;
  const tokensUsed = typeof usage?.total_tokens === "number" ? usage.total_tokens : null;

  const sources = (response.citations ?? []).map((url) => ({ url }));

  return {
    sources,
    synthesised: (response.content ?? "").trim(),
    fetched_at: new Date().toISOString(),
    model: response.model,
    tokens_used: tokensUsed,
    research_prompt_version: args.researchPromptVersion,
  };
}
