// LLM-driven conversational resolver (Step 2).
//
// Replaces the rule-based clarification stages (Stage-1 sport disambiguation,
// generic "give me more info" templates) with a single conversational loop.
// Each turn the driver (Claude Haiku 4.5) is given the running USER transcript
// and returns a STRUCTURED decision: resolve | clarify | decline.
//
// The server NEVER trusts client-supplied assistant turns. The client sends
// only the user's replies (`user_turns: string[]`); the assistant's prior
// questions live in the frontend's local state for the visible chat bubbles
// but are not part of the trust boundary on the server.
//
// On parse / network failure the resolver FAILS OPEN to a CLARIFY (never an
// error). Policy declines are handled primarily by the existing moderation
// POLICY check; the resolver's DECLINE is a secondary safety net.

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const RESOLVER_TIMEOUT_MS = 10_000;
export const MAX_USER_TURNS = 5;

export interface ResolveDecision {
  action: "resolve";
  domain: "sport" | "politics" | "markets" | "entertainment";
  canonical_event: string;
  sport: string | null;
  approx_date: string | null;
  competitors: string[];
}
export interface ClarifyDecision {
  action: "clarify";
  message: string;
}
export interface DeclineDecision {
  action: "decline";
  reason: string;
}
export type ResolverDecision = ResolveDecision | ClarifyDecision | DeclineDecision;

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

// Static system prompt — prompt-cached via Anthropic cache_control for ~90%
// input savings on subsequent turns. Plain hyphens only, no smart quotes.
const SYSTEM_PROMPT = `You are the Prophiq event resolver. Your one job is to figure out which real, public, future-resolvable event the user is asking about, then either RESOLVE to a canonical event, ask ONE warm targeted CLARIFY question, or DECLINE for policy.

You are conversational, like a thoughtful person, not a form. Never list options. Never say "please choose from". A picker is built downstream only when you are SURE of a small finite set; otherwise keep talking.

Return STRICT JSON, no markdown fences, no preamble, exactly one of:

{ "action": "resolve", "domain": "sport"|"politics"|"markets"|"entertainment", "canonical_event": "<full canonical event name, with year if it disambiguates>", "sport": "<golf|tennis|football|f1|nfl|...|null>", "approx_date": "<YYYY-MM-DD or null>", "competitors": [<optional list of named competitors>] }

{ "action": "clarify", "message": "<one warm natural follow-up question in plain English, hyphens only, no em-dashes, no smart quotes>" }

{ "action": "decline", "reason": "<plain-English reason. Only for: unsafe/harmful, sexual, fraud/illegal, private individual (non-public), or already-resolved past event>" }

Rules:
- If the user gave a clear unambiguous public event, RESOLVE immediately. Do not stall.
- canonical_event has NO noise words ("golf", "tournament", "match") unless part of the official name. e.g. "Genesis Scottish Open", not "Genesis Scottish Golf Open".
- Niche, specialist, regional, or minor-tour real public events are VALID - RESOLVE them.
- If the user is vague ("the open", "the championship"), CLARIFY with one targeted question. Read the full user history; each new turn refines the earlier ones.
- After the user has given you ~5 turns and it is still ambiguous, RESOLVE on your best honest guess rather than asking again.
- The conversation is the picker. Never enumerate options in your message.
- Policy: DECLINE is rare and only for the five categories listed above.
- Output ONLY JSON. No prose. No code fences.

Horse racing special-case:
- sport MUST be "horse_racing".
- A racing question needs THREE pieces: a course (e.g. Carlisle, Ascot, Saratoga), a date (today/tomorrow/specific date), and either a race time (UK/IRE, e.g. "16:18") or a race number (US/CAN, e.g. "race 5"). If any of these is missing and not obvious from context, CLARIFY for the missing piece conversationally - "Which day - today or tomorrow?", "Do you know the off time?", "Which race number at Saratoga?".
- canonical_event for racing is a clean string in the form "<Course> HH:MM <today|tomorrow|YYYY-MM-DD>" (UK/IRE) or "<Course> race <N> <today|tomorrow|YYYY-MM-DD>" (US/CAN). Examples: "Carlisle 16:18 today", "Ascot 14:20 tomorrow", "Saratoga race 5 today". No "the", no "at", no "who wins".
- If the course name collides with another sport (e.g. Carlisle is also a football club), CLARIFY: "Is that Carlisle the racecourse or Carlisle United the football club?".`;


interface AnthropicContentBlock { type: string; text?: string }
interface AnthropicResponse { content?: AnthropicContentBlock[] }

/**
 * Build the user-side message: a single user message that contains the full
 * accumulated USER transcript. We do NOT include any assistant turns — the
 * model reasons fresh each turn from the user's cumulative statements. This
 * keeps the trust boundary tight: a malicious client cannot inject a fake
 * "assistant: you already confirmed X" turn to steer the resolver.
 */
function buildUserMessage(userTurns: string[], today: Date): string {
  const safeTurns = userTurns
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter((t) => t.length > 0 && t.length <= 500)
    .slice(-MAX_USER_TURNS);
  const numbered = safeTurns
    .map((t, i) => `Turn ${i + 1} (user): ${t}`)
    .join("\n");
  const dateStr = today.toISOString().slice(0, 10);
  const turnHint = safeTurns.length >= MAX_USER_TURNS
    ? "\n\nYou have reached the turn cap. RESOLVE now on your best honest guess - do not CLARIFY again."
    : "";
  return `Today is ${dateStr}.\n\nUser conversation so far:\n${numbered}${turnHint}\n\nReturn the JSON decision.`;
}

export async function runResolverTurn(
  userTurns: string[],
  today: Date,
): Promise<ResolverDecision> {
  const apiKey = readEnv("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.error("[resolver] ANTHROPIC_API_KEY missing - failing open to clarify");
    return failOpenClarify();
  }

  const userMessage = buildUserMessage(userTurns, today);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RESOLVER_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 400,
        temperature: 0,
        // Prompt caching on the static system prompt for ~90% input savings.
        system: [
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    console.error("[resolver] Anthropic fetch failed:", (e as Error).message);
    return failOpenClarify();
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[resolver] Anthropic ${res.status}: ${text.slice(0, 300)}`);
    return failOpenClarify();
  }

  let body: AnthropicResponse;
  try {
    body = await res.json() as AnthropicResponse;
  } catch {
    return failOpenClarify();
  }
  const textBlock = body.content?.find((c) => c.type === "text")?.text ?? "";
  return parseDecision(textBlock);
}

export function parseDecision(text: string): ResolverDecision {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return failOpenClarify();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return failOpenClarify();
  }

  const action = typeof parsed.action === "string" ? parsed.action : "";

  if (action === "clarify") {
    const message = typeof parsed.message === "string" ? sanitize(parsed.message) : "";
    if (!message) return failOpenClarify();
    return { action: "clarify", message };
  }

  if (action === "decline") {
    const reason = typeof parsed.reason === "string" ? sanitize(parsed.reason) : "";
    return {
      action: "decline",
      reason: reason || "I can't take that question.",
    };
  }

  if (action === "resolve") {
    const allowedDomains = new Set(["sport", "politics", "markets", "entertainment"]);
    const domain = typeof parsed.domain === "string" && allowedDomains.has(parsed.domain)
      ? parsed.domain as ResolveDecision["domain"]
      : null;
    const canonical = typeof parsed.canonical_event === "string"
      ? sanitize(parsed.canonical_event)
      : "";
    if (!domain || !canonical) return failOpenClarify();
    const sport = typeof parsed.sport === "string" && parsed.sport.trim().length > 0
      ? parsed.sport.trim().toLowerCase()
      : null;
    const approxDate = typeof parsed.approx_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.approx_date)
      ? parsed.approx_date
      : null;
    const competitors = Array.isArray(parsed.competitors)
      ? parsed.competitors
          .filter((c): c is string => typeof c === "string")
          .map((c) => sanitize(c))
          .filter((c) => c.length > 0)
          .slice(0, 16)
      : [];
    return {
      action: "resolve",
      domain,
      canonical_event: canonical,
      sport,
      approx_date: approxDate,
      competitors,
    };
  }

  return failOpenClarify();
}

function failOpenClarify(): ClarifyDecision {
  return {
    action: "clarify",
    message:
      "Tell me a little more about which event you mean - a name, a date, or a couple of competitors all help me get it right.",
  };
}

// Strip smart quotes / em-dashes / control chars from any LLM-authored copy
// before it's emitted to the user. The UI is hyphens-and-straight-quotes only.
function sanitize(s: string): string {
  return s
    .trim()
    .replace(/[\u2013\u2014]/g, "-") // en-dash, em-dash
    .replace(/[\u2018\u2019]/g, "'") // smart single quotes
    .replace(/[\u201C\u201D]/g, '"') // smart double quotes
    .replace(/[\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}
