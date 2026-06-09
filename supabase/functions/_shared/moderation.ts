// Submit-question moderation. Two stages:
//   1) pre_filter: cheap regex/heuristic checks (length, banned topics, junk)
//   2) moderation: LLM-backed CLASSIFY + POLICY split.
//
// Step-1 rebuild contract (see prophiq-conversational-agent-rebuild.md):
//   - The ONLY thing that can hard-stop a request is a POLICY breach
//     (unsafe/sexual/fraud/private-individual/already-resolved). Niche-ness
//     or uncertainty NEVER reject — they downgrade `confidence` so the
//     caller can route to a conversational clarification or the
//     research-grounded forecast floor.
//   - Failure modes (network error, malformed JSON, empty content) fail
//     OPEN: low-confidence "accept", policy_breach=false. The caller
//     decides whether to clarify or attempt research_grounded.
//
// `decision` is retained as a back-compat alias of `policy_breach ? "reject" : "accept"`.

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
    // prompt-injection patterns
    /\bignore (previous|all|the|above) (instructions|prompts?|context|rules?)\b/i,
    /\byou are (now|actually) (a different|an? un?safe|a (?:dev|admin) ai)\b/i,
    /\b(disregard|forget) (the )?(previous|all|above) (instructions?|prompts?)\b/i,
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
  /** Back-compat alias: "reject" iff policy_breach, else "accept". */
  decision: "accept" | "reject";
  /** True ONLY for the five policy categories. Never true for uncertainty. */
  policy_breach: boolean;
  /** Kind, conversational decline text. Only meaningful when policy_breach. */
  policy_reason: string | null;
  /** Classifier self-report. Caller routes low → clarify, high → forecast. */
  confidence: "high" | "low";
  domain: string | null;
  /** Legacy reason field (kept for analytics). May restate policy_reason. */
  reason: string | null;
  /** ISO 8601 if model could pin one down; null is OK and caller defaults. */
  starts_at: string | null;
  resolves_at: string | null;
  /** Suggested rewritten predictive question. */
  normalized_question: string | null;
  outcomes: string[];
  metadata: Record<string, unknown>;
}

const MODERATION_SYSTEM =
  `You are a CLASSIFY + POLICY step for a public prediction app. Return STRICT JSON only.

Two distinct jobs:

1) POLICY (hard stop) — set policy_breach=true ONLY if the question is one of:
   - unsafe / harmful
   - sexual
   - fraudulent / illegal
   - about a private (non-public) individual
   - about an event that has ALREADY been resolved

2) CLASSIFY (never reject) — for every other question, return your best guess
   at domain, normalized_question, outcomes, dates, and a confidence signal:
   - confidence="high" when you can identify a single clear public event/intent
   - confidence="low" when the intent is ambiguous, the event is unclear,
     multiple plausible interpretations exist, or you cannot pin down a
     specific event from the wording

NEVER set policy_breach=true for niche-ness, obscurity, vagueness, uncertainty,
or missing dates. Minor tours, regional elections, small competitions, product
launches, indie events — all VALID. The caller will route low-confidence
questions to a conversational clarification or a research-grounded forecast.
Your job is to surface the signal, not to gatekeep.

Treat ambiguous time references ("next election", "this year's Masters",
"upcoming Fed meeting") as the NEXT future occurrence — never reject for a
missing date. Leave dates null if unknown.

OUTCOME RULES (apply to every classified question):
- Outcomes MUST be REAL, NAMED contenders or concrete results. For a "who wins X"
  question, list the actual most-likely competitors BY NAME (e.g. "Carlos Alcaraz",
  "Jannik Sinner", "Novak Djokovic" — NOT "the men's singles champion"). For yes/no
  or threshold questions, use the concrete outcomes ("Higher", "Lower"; "Rate cut",
  "No change").
- NEVER use hedge / non-answer / placeholder labels as outcomes. FORBIDDEN examples:
  "cannot determine", "cannot be determined", "to be confirmed", "TBD", "unknown",
  "too early to say", "no clear favourite", "a surprise underdog wins", "a surprise
  winner", "the champion", "the winner", "men's/women's singles champion", or any
  role/title label that is not a specific named entity.
- If you genuinely cannot name contenders (e.g. a field months out with no public
  favourites), still NAME the most likely real candidates from general knowledge
  (top-ranked players / teams / drivers for that competition). Do NOT substitute a
  hedge label. A best-effort named field is required; a hedge is a failure.
- It is fine for the named outcomes to NOT cover the whole field — the downstream
  forecast adds the remaining probability as "Rest of the field" automatically. So
  list the real contenders and stop; never pad with a vague catch-all as outcome #1.`;

export function buildModerationPrompt(question: string, today: Date): string {
  const todayIso = today.toISOString().slice(0, 10);
  return `Today is ${todayIso}.

User-submitted question: """${question}"""

Return JSON:
{
  "policy_breach": true | false,
  "policy_reason": "kind, plain-English explanation if policy_breach, else null",
  "confidence": "high" | "low",
  "domain": "sport|politics|markets|entertainment|other|null",
  "reason": "short human-readable reason for the classification, or null",
  "starts_at": "ISO8601 UTC if the event has a known start, else null",
  "resolves_at": "ISO8601 UTC if the event has a known resolution time, else null",
  "normalized_question": "rewritten as a clear predictive question (e.g. 'Who will win X?')",
  "outcomes": ["2-6 plausible outcome labels"],
  "metadata": { "...any structured extras..." }
}

Reminders:
- policy_breach=true ONLY for unsafe/sexual/fraud/private-individual/already-resolved.
- Niche or obscure real public events are VALID — set confidence="low" if unsure, never policy_breach.
- Always provide normalized_question and outcomes even when confidence is low.`;
}

/**
 * Coerce a raw moderation JSON blob into a typed decision. NEVER throws.
 *
 * FAIL OPEN: unparseable / empty / malformed input → accept with
 * confidence="low" and policy_breach=false. The caller routes from there.
 */
export function coerceModerationResult(raw: unknown): ModerationDecision {
  const failOpen: ModerationDecision = {
    decision: "accept",
    policy_breach: false,
    policy_reason: null,
    confidence: "low",
    domain: null,
    reason: "moderation returned no structured output; failing open",
    starts_at: null,
    resolves_at: null,
    normalized_question: null,
    outcomes: [],
    metadata: {},
  };
  if (!raw || typeof raw !== "object") return failOpen;
  const r = raw as Record<string, unknown>;

  // Back-compat: older prompts emitted {decision:"reject"}. Treat that as
  // policy_breach ONLY if a policy_reason / reason hints at the five real
  // categories. Otherwise downgrade to low-confidence accept (per Step 1).
  const legacyReject = r.decision === "reject";
  const rawPolicyBreach = r.policy_breach === true;
  const policyReasonRaw = typeof r.policy_reason === "string" ? r.policy_reason : null;
  const reasonRaw = typeof r.reason === "string" ? r.reason : null;
  const policyHint = (policyReasonRaw ?? reasonRaw ?? "").toLowerCase();
  const POLICY_KEYWORDS = /(unsafe|harm|sexual|fraud|illegal|private (individual|person)|already (resolved|happened|over))/;
  const policy_breach = rawPolicyBreach || (legacyReject && POLICY_KEYWORDS.test(policyHint));

  const confidence: "high" | "low" = r.confidence === "high" ? "high" : "low";
  const domain = typeof r.domain === "string" && r.domain !== "null"
    ? r.domain.toLowerCase()
    : null;
  const starts_at = isoOrNull(r.starts_at);
  const resolves_at = isoOrNull(r.resolves_at);
  const normalized_question = typeof r.normalized_question === "string"
    ? r.normalized_question
    : null;
  const outcomes = Array.isArray(r.outcomes)
    ? r.outcomes.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 6)
    : [];
  const metadata = (r.metadata && typeof r.metadata === "object")
    ? r.metadata as Record<string, unknown>
    : {};

  return {
    decision: policy_breach ? "reject" : "accept",
    policy_breach,
    policy_reason: policy_breach
      ? (policyReasonRaw ?? reasonRaw ?? "We can't take that question.")
      : null,
    confidence,
    domain,
    reason: reasonRaw,
    starts_at,
    resolves_at,
    normalized_question,
    outcomes,
    metadata,
  };
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

/** Call Perplexity to run the moderation step. FAILS OPEN on any error. */
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
    console.warn(`[moderation] service error, failing open: ${(err as Error).message}`);
    return {
      decision: "accept",
      policy_breach: false,
      policy_reason: null,
      confidence: "low",
      domain: null,
      reason: `moderation service error: ${(err as Error).message}`,
      starts_at: null,
      resolves_at: null,
      normalized_question: null,
      outcomes: [],
      metadata: {},
    };
  }
  const content = response.content ?? "";
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return coerceModerationResult(null);
  let parsed: unknown = null;
  try { parsed = JSON.parse(match[0]); } catch { /* fallthrough */ }
  return coerceModerationResult(parsed);
}
