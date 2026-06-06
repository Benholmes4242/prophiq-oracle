// Shared utilities for domain adapters. These are pure helpers, NOT a base
// class — each adapter is independent and imports what it needs.

import type { DiscoveredEvent } from "../domain.ts";
import { hasPlaceholderOutcomes } from "../outcomeQuality.ts";

// Reject events whose start time is more than this far in the past. Small
// grace window (60 minutes) so an event that ticked over while discovery
// was running is not dropped.
const STALE_EVENT_GRACE_MS = 60 * 60 * 1000;

/**
 * Deterministic event ID derived from a CANONICALISED title + ISO start date.
 *
 * The previous implementation hashed a lightly-normalised title, which left
 * the dedup key at the mercy of LLM phrasing variance: "Belmont Stakes",
 * "Belmont Stakes 2026" and "2026 Belmont Stakes - Triple Crown Race" all
 * produced different ids and three separate event rows. The canonical form
 * aggressively strips year prefixes, qualifier suffixes, filler words and
 * known synonyms so semantically-equal titles collapse to the same token
 * set on the same day.
 *
 * Same fixture rediscovered with slightly different wording MUST hash to
 * the same id.
 */
export async function stableEventId(title: string, startsAt: string | Date): Promise<string> {
  const canon = canonicaliseTitle(title);
  const day = toDayKey(startsAt);
  const payload = `${canon}|${day}`;
  return await sha256Hex(payload);
}

/**
 * Backwards-compatible shallow normaliser. Retained for display-safe
 * lowercasing in legacy callers. Dedup MUST use {@link canonicaliseTitle}.
 */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/\b(versus|vs|v)\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TITLE_SYNONYMS: Array<[RegExp, string]> = [
  [/\bu\.?s\.?a?\.?\b/g, " us "],
  [/\bunited states\b/g, " us "],
  [/\buk\b/g, " uk "],
  [/\bunited kingdom\b/g, " uk "],
  [/\bconsumer price index\b/g, " cpi "],
  [/\bproducer price index\b/g, " ppi "],
  [/\bnon-?farm payrolls?\b/g, " nfp "],
  [/\bnonfarm payrolls?\b/g, " nfp "],
  [/\bfederal reserve\b/g, " fed "],
  [/\bfomc\b/g, " fed "],
  [/\bgrand prix\b/g, " gp "],
  [/\bformula\s*1\b/g, " f1 "],
  [/\bformula one\b/g, " f1 "],
];

// Generic event qualifiers and filler words that carry no identity. Stripping
// these is what makes "2026 Belmont Stakes - Triple Crown Race" and "Belmont
// Stakes" both reduce to { belmont, stakes }.
const QUALIFIER_WORDS = new Set([
  "race", "match", "game", "fixture", "event", "edition",
  "final", "finals", "semi", "semifinal", "semifinals",
  "quarterfinal", "quarterfinals", "round", "playoff", "playoffs",
  "stage", "tournament", "championship", "championships",
  "league", "cup", "season",
  "the", "a", "an", "of", "for",
  "triple", "crown", "thoroughbred", "horse", "racing",
  "fc", "club",
]);

/**
 * Canonical token set used by {@link stableEventId} and the discover-events
 * near-duplicate guard. Returns a sorted, space-joined token set (so order
 * of teams or list position does not affect the key).
 */
export function canonicaliseTitle(title: string): string {
  let t = ` ${title.toLowerCase()} `
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/&/g, " and ");
  // Strip 4-digit years ("2026 Belmont Stakes" -> "Belmont Stakes")
  t = t.replace(/\b(19|20)\d{2}\b/g, " ");
  // Strip ordinal suffixes attached to digits ("1st" -> "1")
  t = t.replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1");
  // Normalise vs/v/versus
  t = t.replace(/\b(versus|vs|v)\b/g, " vs ");
  // Apply multi-word synonyms BEFORE punctuation strip
  for (const [re, rep] of TITLE_SYNONYMS) t = t.replace(re, rep);
  // Strip punctuation, collapse whitespace
  t = t.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  // Tokenise: drop qualifier/filler words and 1-char tokens, dedupe, sort.
  const seen = new Set<string>();
  for (const tok of t.split(/\s+/)) {
    if (!tok || tok.length < 2) continue;
    if (QUALIFIER_WORDS.has(tok)) continue;
    seen.add(tok);
  }
  return Array.from(seen).sort().join(" ");
}

/**
 * Sport sub-categories with no wired structured-data feed. Discovery in
 * these categories is pure LLM recall — meaning fabricated events and
 * placeholder outcomes. Until a real feed is wired we refuse to persist
 * them. Horse racing is the proven offender (Belmont x9, Preakness, etc.).
 *
 * This is a stopgap. The real fix is feed-driven discovery.
 */
const FEEDLESS_SPORT_KEYWORDS = [
  "horse_racing", "horse racing", "thoroughbred",
  "belmont stakes", "preakness", "kentucky derby", "epsom derby",
  "royal ascot", "the oaks", "guineas", "breeders cup", "breeders' cup",
  "melbourne cup", "grand national", "cheltenham festival",
  "greyhound", "harness racing",
];

export function isFeedlessSportTitle(opts: {
  title: string;
  metadata?: Record<string, unknown> | null;
}): boolean {
  const md = opts.metadata ?? {};
  const hay = [
    opts.title,
    String((md as Record<string, unknown>).sub_category ?? ""),
    String((md as Record<string, unknown>).league ?? ""),
    String((md as Record<string, unknown>).sport ?? ""),
  ].join(" ").toLowerCase();
  for (const kw of FEEDLESS_SPORT_KEYWORDS) {
    if (hay.includes(kw)) return true;
  }
  return false;
}

function toDayKey(startsAt: string | Date): string {
  const d = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  if (isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (subtle) {
    const buf = await subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Node fallback for tests without WebCrypto
  // deno-lint-ignore no-explicit-any
  const nodeCrypto = await import("node:crypto" as any);
  return nodeCrypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Try hard to pull a JSON array out of a Perplexity response. Models often
 * wrap JSON in prose or ``` fences. Returns [] on any failure — adapters
 * should never throw because of a malformed response.
 */
export function safeExtractJsonArray(content: string): unknown[] {
  if (!content) return [];
  const candidates: string[] = [];
  // Fenced code block
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  // First [...] block
  const bracket = content.match(/\[[\s\S]*\]/);
  if (bracket) candidates.push(bracket[0]);
  // Raw
  candidates.push(content);

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim());
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { events?: unknown[] }).events)) {
        return (parsed as { events: unknown[] }).events;
      }
    } catch {
      // try next
    }
  }
  return [];
}

/**
 * Coerce a possibly-loose item from Perplexity into a DiscoveredEvent. Returns
 * null on validation failure — caller should skip + log.
 */
export async function coerceDiscoveredEvent(
  raw: unknown,
  opts: {
    defaultMode: "prediction" | "odds" | "both";
    slugPrefix: string;
    extraMetadata?: Record<string, unknown>;
  },
): Promise<DiscoveredEvent | null> {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const title = typeof r.title === "string" ? r.title.trim() : "";
  const question = typeof r.question === "string" ? r.question.trim() : "";
  const startsAt = typeof r.starts_at === "string" ? r.starts_at : (typeof r.startsAt === "string" ? r.startsAt : "");
  const resolvesAtRaw = typeof r.resolves_at === "string" ? r.resolves_at : (typeof r.resolvesAt === "string" ? r.resolvesAt : "");
  const outcomesRaw = Array.isArray(r.outcomes) ? r.outcomes : [];
  const description = typeof r.description === "string" ? r.description : undefined;

  if (!title || !startsAt || !question || outcomesRaw.length < 2) return null;

  const startsAtDate = new Date(startsAt);
  if (isNaN(startsAtDate.getTime())) return null;

  // Bug 3: never accept a past event as upcoming. This catches stale LLM
  // recall (prior-year fields) and any feed that mislabels resolved events.
  if (startsAtDate.getTime() < Date.now() - STALE_EVENT_GRACE_MS) {
    return null;
  }

  let resolvesAt = resolvesAtRaw;
  if (!resolvesAt) {
    // Default: +6 hours after start
    resolvesAt = new Date(startsAtDate.getTime() + 6 * 60 * 60 * 1000).toISOString();
  } else if (isNaN(new Date(resolvesAt).getTime())) {
    resolvesAt = new Date(startsAtDate.getTime() + 6 * 60 * 60 * 1000).toISOString();
  }

  const outcomes: DiscoveredEvent["outcomes"] = [];
  for (const o of outcomesRaw) {
    if (typeof o === "string" && o.trim()) {
      outcomes.push({ label: o.trim() });
    } else if (o && typeof o === "object") {
      const oo = o as Record<string, unknown>;
      const label = typeof oo.label === "string" ? oo.label.trim() : (typeof oo.name === "string" ? oo.name.trim() : "");
      if (!label) continue;
      outcomes.push({
        label,
        external_id: typeof oo.external_id === "string" ? oo.external_id : undefined,
        metadata: oo.metadata && typeof oo.metadata === "object" ? oo.metadata as Record<string, unknown> : undefined,
      });
    }
  }
  if (outcomes.length < 2) return null;

  // Bug 4: reject the entire event if any outcome label is a positional
  // placeholder ("Player with lowest round", "Tied lowest round",
  // "Driver 1", "Field"...). One placeholder is enough to make the whole
  // forecast meaningless — better no event than a fabricated one.
  if (hasPlaceholderOutcomes(outcomes.map((o) => o.label))) {
    return null;
  }

  const externalId = await stableEventId(title, startsAtDate);
  const slug = `${opts.slugPrefix}-${externalId.slice(0, 12)}`;

  const llmMetadata = extractDiscoveryMetadata(r);
  const metadata: Record<string, unknown> = { ...llmMetadata, ...(opts.extraMetadata ?? {}) };
  console.log(`[coerceDiscoveredEvent:${opts.slugPrefix}] r.metadata typeof=${typeof r.metadata} keys=${r.metadata && typeof r.metadata === "object" ? Object.keys(r.metadata as object).join(",") : "n/a"} | llmMetadata=${JSON.stringify(llmMetadata)} | final=${JSON.stringify(metadata)}`);


  return {
    external_id: externalId,
    slug,
    title,
    description,
    question,
    starts_at: startsAtDate.toISOString(),
    resolves_at: new Date(resolvesAt).toISOString(),
    mode: opts.defaultMode,
    outcomes,
    metadata,
  };
}

const TOP_LEVEL_METADATA_KEYS = [
  "sub_category",
  "subCategory",
  "favorite_label",
  "favoriteLabel",
  "field_size",
  "fieldSize",
  "league",
  "sport",
  "asset",
  "event_type",
  "eventType",
  "instrument",
  "region",
  "country",
  "type",
  "chamber",
  "category",
  "franchise",
  "network",
] as const;

function extractDiscoveryMetadata(r: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  if (r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata)) {
    Object.assign(metadata, r.metadata as Record<string, unknown>);
  }

  // Be tolerant of providers/models that flatten metadata fields despite the
  // nested schema. Without this, top-level sub_category/favorite_label/field_size
  // are silently dropped and only adapter-controlled flags survive.
  for (const key of TOP_LEVEL_METADATA_KEYS) {
    if (r[key] !== undefined && metadata[key] === undefined) metadata[key] = r[key];
  }

  if (metadata.sub_category === undefined && typeof metadata.subCategory === "string") {
    metadata.sub_category = metadata.subCategory;
  }
  if (metadata.favorite_label === undefined && (typeof metadata.favoriteLabel === "string" || metadata.favoriteLabel === null)) {
    metadata.favorite_label = metadata.favoriteLabel;
  }
  if (metadata.field_size === undefined && metadata.fieldSize !== undefined) {
    metadata.field_size = metadata.fieldSize;
  }
  if (metadata.event_type === undefined && typeof metadata.eventType === "string") {
    metadata.event_type = metadata.eventType;
  }

  if (typeof metadata.field_size === "string") {
    const parsed = Number.parseInt(metadata.field_size, 10);
    if (Number.isFinite(parsed)) metadata.field_size = parsed;
  }

  return metadata;
}

export function logSkip(domain: string, reason: string, raw: unknown): void {
  // Lightweight logger — adapters should never throw on bad items.
  try {
    const preview = JSON.stringify(raw).slice(0, 200);
    console.warn(`[domain:${domain}] skipped item (${reason}): ${preview}`);
  } catch {
    console.warn(`[domain:${domain}] skipped item (${reason})`);
  }
}
