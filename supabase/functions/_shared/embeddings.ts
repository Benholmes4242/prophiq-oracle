// OpenAI embeddings via text-embedding-3-small.
// Returns 1536-dimension float arrays for storage in events.embedding.
// Reuses the existing OPENAI_API_KEY env var (same key used by callGPT).

const OPENAI_EMBEDDINGS_ENDPOINT = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_TIMEOUT_MS = 10_000;

export const EMBEDDING_MODEL_ID = EMBEDDING_MODEL;
export const EMBEDDING_DIMS = EMBEDDING_DIMENSIONS;

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

/**
 * Generate a single text embedding via OpenAI text-embedding-3-small.
 * Throws on any API failure (caller handles fallback).
 */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const trimmed = text.trim();
  if (!trimmed) throw new Error("embedText called with empty input");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(OPENAI_EMBEDDINGS_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: trimmed,
        encoding_format: "float",
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI embeddings ${res.status}: ${errText.slice(0, 500)}`);
  }

  const body = (await res.json()) as EmbeddingResponse;
  const vector = body.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding has wrong shape: expected ${EMBEDDING_DIMENSIONS}-dim array, got ${vector?.length ?? "non-array"}`,
    );
  }
  return vector;
}

/**
 * Build the text fed to the embedder for a given event. Concatenates
 * title and question so both high-level framing and specific question
 * contribute to the embedding.
 */
export function buildEmbeddingInput(event: { title: string; question: string }): string {
  const title = (event.title ?? "").trim();
  const question = (event.question ?? "").trim();
  if (title && question) return `${title}. ${question}`;
  return title || question;
}
