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
  responseFormat?: Record<string, unknown>;
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

  console.log(`[Perplexity] HTTP ${res.status}, ok=${res.ok}`);

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
