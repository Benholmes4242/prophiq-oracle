// Entertainment domain adapter. Prediction-only. Covers awards shows,
// box-office openings, album/single chart debuts, reality-show finales.
// No betting/odds framing.

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
import { formatStructuredDataBlock, type StructuredData } from "../structuredData.ts";
import { coerceDiscoveredEvent, logSkip, safeExtractJsonArray } from "./_util.ts";

const RESEARCH_PROMPT_VERSION = "entertainment.research.v1";

const RESEARCH_SYSTEM = `You are an entertainment industry analyst providing factual research. Return ONLY the research findings as 4-6 short paragraphs of plain prose. No editorial opinions, no predictions - just the data and recent momentum signals a good analyst would assemble.`;

function buildEntertainmentResearchUser(event: DomainEvent, outcomes: EventOutcome[]): string {
  const labels = outcomes.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  return `Research the following upcoming entertainment event:

Event: ${event.title}
Question: ${event.question}
Scheduled: ${event.starts_at}

Outcomes being considered:
${labels}

In 200-400 words, cover anything material to forecasting the outcome:
- Recent guild awards, critic awards, or precursor signals
- Festival reception, review scores, or critical consensus
- Industry insider commentary from trade publications
- Betting market activity where publicly available
- Box office, streaming, or audience momentum if applicable
- Any breaking news from the last 30 days that bears on the event

Be factual. Cite specific events, awards, and dates inline. Do not produce a prediction.`;
}

const DOMAIN_ID = "entertainment";

const DISCOVERY_SYSTEM = `You are an entertainment-industry research assistant. Return STRICT JSON only — no prose, no markdown. Identify upcoming entertainment events in the next 30 days: awards ceremonies (Oscars, Grammys, Emmys, etc.), major film openings, album releases, reality-show finales, and high-profile cultural events. Do NOT use betting or odds language.`;

const DISCOVERY_USER = (now: Date) => `It is currently early June 2026. Find entertainment events between today and 30 days from today.

List upcoming scheduled entertainment events between ${now.toISOString()} and ${new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()}.

Return a JSON array. Each element:
{
  "title": "Short event title",
  "question": "Predictive question (e.g. 'Who will win Best Picture at the 2026 Oscars?')",
  "description": "Context (ceremony, category, frontrunners)",
  "starts_at": "ISO 8601 UTC",
  "resolves_at": "ISO 8601 UTC",
  "outcomes": [
    { "label": "Nominee A" },
    { "label": "Nominee B" }
  ],
  "metadata": {
    "category": "...",
    "event_type": "awards|release|finale",
    "sub_category": "REQUIRED. One of: awards, film_release, album_release, reality_show, other",
    "favorite_label": "Name of the most likely winner / chart-topper (must exactly match one of the outcome labels), or null if uncertain",
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
- favorite_label MUST exactly match one of the outcome labels, or be null if uncertain.
- field_size is the integer count of nominees/outcomes (use outcomes.length when uncertain).

Return as many real, scheduled events as you can find. Use awards-show calendars, release schedules, and industry trade coverage. If you genuinely can't find any, return [].`;

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
              franchise: { type: "string" },
              network: { type: "string" },
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

export const entertainmentAdapter: DomainAdapter = {
  id: DOMAIN_ID,
  displayName: "Entertainment",

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
    const out: DiscoveredEvent[] = [];
    for (const item of items) {
      try {
        const ev = await coerceDiscoveredEvent(item, {
          defaultMode: "prediction",
          slugPrefix: "ent",
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
            content: `You are an entertainment results verifier. Return STRICT JSON only. Look up the official outcome of the event below and rank the outcomes from most-correct (rank 1) to least-correct.`,
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
      userPrompt: buildEntertainmentResearchUser(event, outcomes),
      researchPromptVersion: RESEARCH_PROMPT_VERSION,
      recencyFilter: "month",
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
    return `Entertainment analysis task. Do NOT use betting or odds framing.

Event: ${event.title}
Question: ${event.question}
Scheduled: ${event.starts_at}

Outcomes:
${outcomes.map((o, i) => `${i + 1}. ${o.label}`).join("\n")}
${researchBlock}${priorBlock}${marketBlock}${structuredBlock}
Rank every outcome from most likely (rank 1) to least likely. For each, provide a probability (0-1), a fit_score (0-1), and 1-3 short reasons grounded in critic reception, precursor awards, industry buzz, historical base rates, and the research above when present.`;
  },

  gatherStructuredData(): Promise<StructuredData | null> {
    // Phase 3.3 follow-on brief will wire TMDB + awards-history integration here.
    return Promise.resolve(null);
  },
};

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
