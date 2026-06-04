// Politics domain adapter. Prediction-only (NO odds/betting framing).
// Discovers upcoming political events (elections, votes, confirmations,
// leadership contests) and resolves outcomes via Perplexity.

import type {
  DiscoveredEvent,
  DomainAdapter,
  DomainEvent,
  EventOutcome,
  ResearchContext,
  ResolutionResult,
} from "../domain.ts";
import { fetchResearchContext, perplexityChat } from "../perplexity.ts";
import { formatPriorBlock, type PriorContext } from "../priorContext.ts";
import { formatMarketSignalsBlock, type MarketSignal } from "../marketSignals.ts";
import {
  formatStructuredDataBlock,
  STRUCTURED_DATA_TIMEOUT_MS,
  type StructuredData,
  type StructuredDataContext,
  type StructuredDataError,
  type StructuredDataSource,
  withTimeout,
} from "../structuredData.ts";
import { searchPolymarketMarkets } from "../marketVenues/polymarket.ts";
import { searchKalshiMarkets } from "../marketVenues/kalshi.ts";
import { coerceDiscoveredEvent, logSkip, safeExtractJsonArray } from "./_util.ts";

const RESEARCH_PROMPT_VERSION = "politics.research.v1";

const RESEARCH_SYSTEM = `You are a non-partisan political analyst providing neutral, factual research. Return ONLY the research findings as 4-6 short paragraphs of plain prose. Maintain strict neutrality - present facts, polls, and statements without editorial framing. No advocacy. No predictions. Just the data.`;

function buildPoliticsResearchUser(event: DomainEvent, outcomes: EventOutcome[]): string {
  const labels = outcomes.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  return `Research the following upcoming political event:

Event: ${event.title}
Question: ${event.question}
Scheduled: ${event.starts_at}

Outcomes being considered:
${labels}

In 200-400 words, cover anything material to forecasting the outcome:
- Latest reliable polling with dates, pollsters, and sample sizes
- Recent material statements or actions by the principals or relevant parties
- Prediction market signals where publicly available (Polymarket, Kalshi, PredictIt as applicable)
- Expert commentary from credible non-partisan sources
- Notable endorsements, debates, or events in the last 14 days

Stay strictly non-partisan. Present facts without editorial framing. Cite sources and dates inline. Do not produce a prediction yourself.`;
}

const DOMAIN_ID = "politics";

const DISCOVERY_SYSTEM = `You are a politics research assistant. Return STRICT JSON only — no prose, no markdown. Identify upcoming political events (elections, parliamentary votes, leadership contests, confirmations, referendums) in the next 30 days. Use neutral, non-partisan language. Do NOT use betting or odds language.`;

const DISCOVERY_USER = (now: Date) => `It is currently early June 2026. Find political events between today and 30 days from today.

List upcoming scheduled political events between ${now.toISOString()} and ${new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()}.

Return a JSON array. Each element:
{
  "title": "Short event title",
  "question": "Neutral predictive question (e.g. 'Which party will win the most seats?')",
  "description": "Context (jurisdiction, stakes)",
  "starts_at": "ISO 8601 UTC",
  "resolves_at": "ISO 8601 UTC",
  "outcomes": [
    { "label": "Candidate or option A" },
    { "label": "Candidate or option B" }
  ],
  "metadata": {
    "country": "...",
    "type": "election|vote|leadership",
    "sub_category": "REQUIRED. One of: election, leadership_contest, parliamentary_vote, referendum, confirmation, other",
    "favorite_label": "Name of the most likely winner (must exactly match one of the outcome labels), or null if no clear frontrunner",
    "field_size": 0
  }
}

CRITICAL RULES FOR OUTCOMES:
1. Outcome labels MUST be real, named entities — never positional placeholders.
   - WRONG: "Driver 1", "Team A", "Candidate A", "Nominee A"
   - RIGHT: "Max Verstappen", "Arsenal", "Chuck Schumer", "Cillian Murphy"
2. If you don't know enough about an event to name 2+ real outcomes with confidence, skip the event entirely (don't add it with placeholder outcomes).
3. For events with many possible competitors (e.g. F1, MotoGP, athletics, golf majors), list the 3-6 most likely contenders by name.
4. For head-to-head fixtures, name both sides ("Liverpool win", "Draw", "Manchester City win").
5. For tournaments, name the favourites.

CRITICAL RULES FOR METADATA:
- sub_category is MANDATORY and MUST be one of the listed enum values for this domain.
- favorite_label MUST exactly match one of the outcome labels, or be null if no clear favorite exists yet.
- field_size is the integer count of candidates/outcomes (use outcomes.length when uncertain).

Return as many real, scheduled events as you can find. Use official schedules, parliamentary calendars, election commissions, and reputable political reporting. If you genuinely can't find any, return [].`;

const DISCOVERY_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          question: { type: "string" },
          description: { type: "string" },
          starts_at: { type: "string" },
          resolves_at: { type: "string" },
          outcomes: {
            type: "array",
            items: {
              type: "object",
              properties: { label: { type: "string" } },
              required: ["label"],
            },
          },
          metadata: {
            type: "object",
            properties: {
              sub_category: { type: "string" },
              favorite_label: { type: ["string", "null"] },
              field_size: { type: "integer" },
              country: { type: "string" },
              chamber: { type: "string" },
            },
            required: ["sub_category", "favorite_label", "field_size"],
            additionalProperties: true,
          },
        },
        required: ["title", "question", "starts_at", "outcomes", "metadata"],
      },
    },
  },
  required: ["events"],
} as const;

export const politicsAdapter: DomainAdapter = {
  id: DOMAIN_ID,
  displayName: "Politics",

  async discover(now: Date): Promise<DiscoveredEvent[]> {
    let response;
    try {
      response = await perplexityChat(
        [
          { role: "system", content: DISCOVERY_SYSTEM },
          { role: "user", content: DISCOVERY_USER(now) },
        ],
        {
          model: "sonar-pro",
          temperature: 0.1,
          maxTokens: 2000,
          responseFormat: {
            type: "json_schema",
            json_schema: { schema: DISCOVERY_SCHEMA as unknown as Record<string, unknown> },
          },
        },
      );
    } catch (err) {
      console.warn(`[domain:${DOMAIN_ID}] discover failed:`, (err as Error).message);
      return [];
    }

    console.log(`[domain:${DOMAIN_ID}] raw response preview:`, response.content.slice(0, 800));
    const items = safeExtractJsonArray(response.content);
    console.log(`[domain:${DOMAIN_ID}] parsed event[0] keys:`, items[0] && typeof items[0] === "object" ? Object.keys(items[0] as object) : null, "metadata:", JSON.stringify((items[0] as { metadata?: unknown } | undefined)?.metadata));
    const out: DiscoveredEvent[] = [];
    for (const item of items) {
      try {
        const ev = await coerceDiscoveredEvent(item, {
          defaultMode: "prediction",
          slugPrefix: "politics",
        });
        if (!ev) {
          logSkip(DOMAIN_ID, "invalid shape", item);
          continue;
        }
        out.push(ev);
      } catch (err) {
        logSkip(DOMAIN_ID, `coerce error: ${(err as Error).message}`, item);
      }
    }
    return out;
  },

  async resolve(event: DomainEvent, outcomes: EventOutcome[]): Promise<ResolutionResult | null> {
    const labels = outcomes.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
    let response;
    try {
      response = await perplexityChat(
        [
          {
            role: "system",
            content: `You are a political results verifier. Return STRICT JSON only. Look up the official outcome of the event below and rank the outcomes from most-correct (rank 1) to least-correct. Use neutral language.`,
          },
          {
            role: "user",
            content: `Event: ${event.title}\nQuestion: ${event.question}\nScheduled: ${event.starts_at}\n\nOutcomes:\n${labels}\n\nReturn JSON:\n{ "rankings": [ { "label": "<exact label>", "rank": 1 } ], "context": "Brief verification with source" }\n\nIf unresolved, return { "rankings": [], "context": "unresolved" }.`,
          },
        ],
        { model: "sonar", temperature: 0.0, maxTokens: 600 },
      );
    } catch (err) {
      console.warn(`[domain:${DOMAIN_ID}] resolve failed:`, (err as Error).message);
      return null;
    }
    return parseResolution(response.content, outcomes);
  },

  async gatherResearch(event: DomainEvent, outcomes: EventOutcome[]): Promise<ResearchContext> {
    return await fetchResearchContext({
      systemPrompt: RESEARCH_SYSTEM,
      userPrompt: buildPoliticsResearchUser(event, outcomes),
      researchPromptVersion: RESEARCH_PROMPT_VERSION,
      recencyFilter: "week",
      maxTokens: 800,
    });
  },

  buildPrompt(
    event: DomainEvent,
    outcomes: EventOutcome[],
    _mode?: "prediction" | "odds",
    research?: ResearchContext,
    priors?: PriorContext[],
    marketSignals?: MarketSignal[],
    structuredData?: StructuredData | null,
  ): string {
    const researchBlock = research?.synthesised
      ? `\nLIVE RESEARCH CONTEXT (fetched ${research.fetched_at}):\n${research.synthesised}\n`
      : "";
    const priorBlock = formatPriorBlock(priors ?? []);
    const marketBlock = formatMarketSignalsBlock(marketSignals ?? []);
    const structuredBlock = formatStructuredDataBlock(structuredData ?? null);
    return `Political analysis task. Use neutral, non-partisan language. Do NOT use betting or odds framing.

Event: ${event.title}
Question: ${event.question}
Date: ${event.starts_at}

Outcomes:
${outcomes.map((o, i) => `${i + 1}. ${o.label}`).join("\n")}
${researchBlock}${priorBlock}${marketBlock}${structuredBlock}
Rank every outcome from most likely (rank 1) to least likely. For each, provide a probability (0-1), a fit_score (0-1), and 1-3 short reasons grounded in polling, recent statements, historical base rates, current political dynamics, and the research above when present.`;
  },

  gatherStructuredData(): Promise<StructuredData | null> {
    // Legacy single-source slot reserved for a future polling aggregator.
    // Brief GG multi-source feeds (Polymarket + Kalshi) live in
    // gatherStructuredSources below.
    return Promise.resolve(null);
  },

  async gatherStructuredSources(
    _supabase,
    event: DomainEvent,
    _outcomes: EventOutcome[],
  ): Promise<StructuredDataContext> {
    const t0 = Date.now();
    const query = `${event.title} ${event.question ?? ""}`.trim();

    const [polyRes, kalshiRes] = await Promise.allSettled([
      runSource("polymarket", () => fetchPolymarketSignals(query)),
      runSource("kalshi", () => fetchKalshiSignals(query)),
    ]);

    const sources: StructuredDataSource[] = [];
    const errors: StructuredDataError[] = [];
    for (const res of [polyRes, kalshiRes]) {
      if (res.status === "fulfilled") {
        if (res.value.kind === "ok") sources.push(res.value.source);
        else errors.push(res.value.error);
      } else {
        errors.push({
          source: "unknown",
          message: (res.reason as Error)?.message ?? "rejected",
          duration_ms: 0,
        });
      }
    }

    return { sources, errors, total_duration_ms: Date.now() - t0 };
  },
};

type SourceResult =
  | { kind: "ok"; source: StructuredDataSource }
  | { kind: "err"; error: StructuredDataError };

async function runSource(
  name: string,
  fetcher: () => Promise<unknown>,
): Promise<SourceResult> {
  const start = Date.now();
  try {
    const data = await withTimeout(fetcher(), STRUCTURED_DATA_TIMEOUT_MS, name);
    const duration_ms = Date.now() - start;
    return {
      kind: "ok",
      source: {
        name,
        data,
        fetched_at: new Date().toISOString(),
        duration_ms,
      },
    };
  } catch (err) {
    return {
      kind: "err",
      error: {
        source: name,
        message: (err as Error).message,
        duration_ms: Date.now() - start,
      },
    };
  }
}

async function fetchPolymarketSignals(query: string) {
  const markets = await searchPolymarketMarkets(query, 5);
  if (markets.length === 0) return { matches: [], note: "no Polymarket markets matched" };
  return {
    matches: markets.map((m) => ({
      question: m.question,
      slug: m.slug,
      end_date: m.end_date,
      volume_usd: m.volume_usd,
      outcomes: m.outcomes.map((o) => ({
        label: o.label,
        implied_probability: o.price,
      })),
    })),
  };
}

async function fetchKalshiSignals(query: string) {
  const markets = await searchKalshiMarkets(query, 5);
  if (markets.length === 0) return { matches: [], note: "no Kalshi markets matched" };
  return {
    matches: markets.map((m) => ({
      ticker: m.ticker,
      event_ticker: m.event_ticker,
      title: m.title,
      subtitle: m.subtitle,
      close_time: m.close_time,
      volume: m.volume,
      yes_implied_probability: m.yes_price,
      no_implied_probability: m.no_price,
    })),
  };
}

function parseResolution(content: string, outcomes: EventOutcome[]): ResolutionResult | null {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      rankings?: Array<{ label?: string; rank?: number }>;
      context?: string;
    };
    if (!Array.isArray(parsed.rankings) || parsed.rankings.length === 0) return null;
    const byLabel = new Map(outcomes.map((o) => [o.label.toLowerCase(), o]));
    const rankings: Array<{ outcome_id: string; rank: number }> = [];
    for (const r of parsed.rankings) {
      if (!r.label || typeof r.rank !== "number") continue;
      const o = byLabel.get(r.label.toLowerCase());
      if (!o) continue;
      rankings.push({ outcome_id: o.id, rank: r.rank });
    }
    if (rankings.length === 0) return null;
    return { outcome_rankings: rankings, source: "perplexity", resolution_context: parsed.context };
  } catch {
    return null;
  }
}
