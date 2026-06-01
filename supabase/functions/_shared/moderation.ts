// Submit-question moderation. Two stages:
//   1) pre_filter: cheap regex/heuristic checks (length, banned topics, junk)
//   2) moderation: LLM-backed structured analysis that ALSO returns a default
//      resolves_at if the model can pin one down — but never rejects solely
//      on a null date. Caller defaults to now + 30 days.
//
// Critical rule (from Phase 3 bug history): the prompt MUST embed today's
// date, and ambiguous references like "next Masters" / "this year's election"
// must be interpreted as the NEXT future occurrence — never rejected for
// missing date.

import { perplexityChat } from "./perplexity.ts";

export interface PreFilterResult {
  ok: boolean;
  reason?: string;
}

export function preFilter(question: string): PreFilterResult {
  if (!question || typeof question !== "string") return { ok: false, reason: "empty question" };
  const q = question.trim();
  if (q.length < 10) return { ok: false, reason: "question too short (min 10 chars)" };
  if (q.length > 500) return { ok: false, reason: "question too long (max 500 chars)" };

  const banned = [
    /\bkill (myself|yourself|themselves|himself|herself)\b/i,
    /\bsuicide\b/i,
    /\bcsam\b/i,
    /\bchild (porn|sexual)\b/i,
    /\b(how to (make|build) (a )?(bomb|weapon))\b/i,
  ];
  for (const re of banned) {
    if (re.test(q)) return { ok: false, reason: "question violates safety policy" };
  }

  // Junk: no letters at all, or single repeated character
  if (!/[a-zA-Z]/.test(q)) return { ok: false, reason: "question contains no letters" };
  if (/^(.)\1{5,}$/.test(q.replace(/\s+/g, ""))) return { ok: false, reason: "junk input" };

  return { ok: true };
}

export interface ModerationDecision {
  decision: "accept" | "reject";
  domain: string | null;
  reason: string | null;
  /** ISO 8601 if model could pin one down; null is OK and caller defaults. */
  starts_at: string | null;
  resolves_at: string | null;
  /** Suggested rewritten predictive question (if accepted). */
  normalized_question: string | null;
  outcomes: string[];
  metadata: Record<string, unknown>;
}

const MODERATION_SYSTEM = `You are a moderation + classification step for a public prediction app. Return STRICT JSON only. Treat ambiguous time references ("next election", "this year's Masters", "upcoming Fed meeting") as the NEXT future occurrence. NEVER reject a question solely because you cannot pin down an exact date — leave the date null and let the caller default it.`;

export function buildModerationPrompt(question: string, today: Date): string {
  const todayIso = today.toISOString().slice(0, 10);
  return `Today is ${todayIso}.

User-submitted question: """${question}"""

Decide whether this is a valid public, future-resolvable prediction question. Reject ONLY if:
- it asks about something already resolved
- it is personal/private (about an identifiable individual not in public life)
- it cannot be objectively resolved
- it violates safety policy

Pick the best domain from: sport, politics, markets, entertainment, other.

Return JSON:
{
  "decision": "accept" | "reject",
  "domain": "sport|politics|markets|entertainment|other|null",
  "reason": "short human-readable reason, null if accepted",
  "starts_at": "ISO8601 UTC if the event has a known start, else null",
  "resolves_at": "ISO8601 UTC if the event has a known resolution time, else null",
  "normalized_question": "rewritten as a clear predictive question (e.g. 'Who will win X?'), null if rejected",
  "outcomes": ["2-6 plausible outcome labels", "..."],
  "metadata": { "...any structured extras..." }
}`;
}

/**
 * Coerce a raw moderation JSON blob into a typed decision. NEVER throws —
 * returns a structured "reject"/"accept" with sensible defaults. The caller
 * applies the now+30d default for resolves_at when null.
 */
export function coerceModerationResult(raw: unknown): ModerationDecision {
  const empty: ModerationDecision = {
    decision: "reject",
    domain: null,
    reason: "unparseable moderation response",
    starts_at: null,
    resolves_at: null,
    normalized_question: null,
    outcomes: [],
    metadata: {},
  };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;
  const decision = r.decision === "accept" ? "accept" : "reject";
  const domain = typeof r.domain === "string" && r.domain !== "null" ? r.domain.toLowerCase() : null;
  const reason = typeof r.reason === "string" ? r.reason : null;
  const starts_at = isoOrNull(r.starts_at);
  const resolves_at = isoOrNull(r.resolves_at);
  const normalized_question = typeof r.normalized_question === "string" ? r.normalized_question : null;
  const outcomes = Array.isArray(r.outcomes)
    ? r.outcomes.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 6)
    : [];
  const metadata = (r.metadata && typeof r.metadata === "object") ? r.metadata as Record<string, unknown> : {};
  return { decision, domain, reason, starts_at, resolves_at, normalized_question, outcomes, metadata };
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Apply the resolves_at fallback rule: if null, default to now + 30 days.
 * If starts_at is set and after now, use starts_at + 6h instead.
 */
export function defaultResolvesAt(decision: ModerationDecision, now: Date): string {
  if (decision.resolves_at) return decision.resolves_at;
  if (decision.starts_at) {
    const s = new Date(decision.starts_at);
    if (s.getTime() > now.getTime()) {
      return new Date(s.getTime() + 6 * 60 * 60 * 1000).toISOString();
    }
  }
  return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

/** Call Perplexity to run the moderation step. Caller handles persistence. */
export async function runModeration(question: string, today: Date): Promise<ModerationDecision> {
  let response;
  try {
    response = await perplexityChat(
      [
        { role: "system", content: MODERATION_SYSTEM },
        { role: "user", content: buildModerationPrompt(question, today) },
      ],
      { model: "sonar", temperature: 0.0, maxTokens: 600 },
    );
  } catch (err) {
    return {
      decision: "reject", domain: null,
      reason: `moderation service error: ${(err as Error).message}`,
      starts_at: null, resolves_at: null, normalized_question: null, outcomes: [], metadata: {},
    };
  }
  const content = response.content ?? "";
  // pull JSON object out
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return coerceModerationResult(null);
  let parsed: unknown = null;
  try { parsed = JSON.parse(match[0]); } catch { /* fallthrough */ }
  return coerceModerationResult(parsed);
}
