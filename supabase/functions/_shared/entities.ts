// Entity extraction via Anthropic Claude Haiku. Called once per event
// (cached via event_entities existence check). Cost: ~$0.0005 per call.

export interface ExtractedEntity {
  value: string;
  type: "person" | "team" | "organization" | "event" | "place" | "date" | "other";
  confidence: number;
}

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const EXTRACTION_TIMEOUT_MS = 8_000;

const SYSTEM_PROMPT = `You extract named entities from forecasting questions. Return STRICT JSON only - no preamble, no markdown fences. Be conservative: only emit entities you are highly confident about. Use the smallest specific span, not paraphrases.

Output shape:
{
  "entities": [
    { "value": "<exact name as it appears or canonical form>", "type": "<one of: person|team|organization|event|place|date|other>", "confidence": <0..1> }
  ]
}

Type definitions:
- person: a specific human ("Max Verstappen", "Keir Starmer")
- team: a sports team or band ("Manchester City", "Coldplay")
- organization: a company, government body, central bank ("ECB", "Anthropic", "Federal Reserve")
- event: a named occurrence ("2026 Bahrain Grand Prix", "98th Academy Awards", "May FOMC meeting")
- place: a city, country, region ("London", "United Kingdom", "Eurozone")
- date: a specific date or time window ("June 2026", "Q2 2026", "next Tuesday")
- other: anything important but not in the categories above

If you cannot find any entities with confidence, return { "entities": [] }.`;

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

export async function extractEntities(question: string): Promise<ExtractedEntity[]> {
  const apiKey = readEnv("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const userPrompt = `Question: ${question.trim()}\n\nExtract entities. Return JSON only.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 400,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 500)}`);
  }

  const body = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const textBlock = body.content?.find((c) => c.type === "text")?.text ?? "";
  return parseEntitiesResponse(textBlock);
}

export function parseEntitiesResponse(text: string): ExtractedEntity[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }

  const root = parsed as { entities?: unknown };
  const list = Array.isArray(root.entities) ? root.entities : [];

  const valid: ExtractedEntity[] = [];
  const allowedTypes = new Set([
    "person", "team", "organization", "event", "place", "date", "other",
  ]);
  for (const item of list) {
    const e = item as Record<string, unknown>;
    const value = typeof e.value === "string" ? e.value.trim() : "";
    const type = typeof e.type === "string" ? e.type.trim().toLowerCase() : "";
    const confidence = typeof e.confidence === "number" ? e.confidence : 0.5;
    if (!value || !allowedTypes.has(type)) continue;
    if (confidence < 0 || confidence > 1) continue;
    valid.push({
      value,
      type: type as ExtractedEntity["type"],
      confidence,
    });
  }
  return valid;
}
