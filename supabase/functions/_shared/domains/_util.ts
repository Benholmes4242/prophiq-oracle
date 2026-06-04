// Shared utilities for domain adapters. These are pure helpers, NOT a base
// class — each adapter is independent and imports what it needs.

import type { DiscoveredEvent } from "../domain.ts";

/**
 * Deterministic event ID derived from a normalised title + ISO start date.
 * Rules:
 *  - lowercase
 *  - strip "vs"/"v"/"versus" tokens
 *  - collapse punctuation and whitespace
 *  - SHA-256 of `${normTitle}|${yyyy-mm-dd}`
 *
 * Same Premier League fixture rediscovered with slightly different wording
 * tomorrow MUST hash to the same id.
 */
export async function stableEventId(title: string, startsAt: string | Date): Promise<string> {
  const norm = normaliseTitle(title);
  const day = toDayKey(startsAt);
  const payload = `${norm}|${day}`;
  return await sha256Hex(payload);
}

export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    // Strip vs/v/versus as standalone tokens
    .replace(/\b(versus|vs|v)\b/g, " ")
    // Strip punctuation
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
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
