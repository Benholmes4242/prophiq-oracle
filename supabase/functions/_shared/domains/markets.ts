// Markets domain adapter. Prediction-only. INFORMATIONAL ONLY — every event
// sets metadata.informationalOnly = true so the frontend renders a financial-
// advice disclaimer. NO betting or odds language.

import type {
  DiscoveredEvent,
  DomainAdapter,
  DomainEvent,
  EventOutcome,
  ResearchContext,
  ResolutionResult,
} from "../domain.ts";
import { fetchResearchContext, perplexityChat } from "../perplexity.ts";
import { coerceDiscoveredEvent, logSkip, safeExtractJsonArray } from "./_util.ts";

const RESEARCH_PROMPT_VERSION = "markets.research.v1";

const RESEARCH_SYSTEM = `You are a financial markets analyst providing factual research for a forecasting model. Return ONLY the research findings as 4-6 short paragraphs of plain prose. Do not give investment advice. Do not produce a prediction or recommendation - just the data and context a good analyst would assemble.`;

function buildMarketsResearchUser(event: DomainEvent, outcomes: EventOutcome[]): string {
  const labels = outcomes.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  return `Research the following upcoming markets event:

Event: ${event.title}
Question: ${event.question}
Scheduled: ${event.starts_at}

Outcomes being considered:
${labels}

In 200-400 words, cover anything material to forecasting the outcome:
- Latest relevant economic data releases (with dates and prints)
- Central bank statements, minutes, or speeches from the last 4 weeks
- Market positioning: futures pricing, OIS curves, swap rates, or implied probabilities where publicly available
- Recent analyst consensus from major sell-side desks (cite without naming specific firms)
- Technical signals where appropriate
- Any breaking news from the last 14 days that bears on the event

Be strictly factual. Do not give investment advice. Cite specific data releases and statements with dates.`;
}

const DOMAIN_ID = "markets";

const DISCOVERY_SYSTEM = `You are a financial-markets research assistant. Return STRICT JSON only — no prose, no markdown. Identify upcoming, scheduled market-moving events (earnings releases, central bank decisions, major economic data prints, IPO debuts) in the next 14 days. Output is INFORMATIONAL ONLY — never use betting language. Frame outcomes as directional movements or numeric ranges.`;

const DISCOVERY_USER = (now: Date) => `It is currently early June 2026. Find market-moving events between today and 14 days from today.

List upcoming scheduled market events between ${now.toISOString()} and ${new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()}.

Return a JSON array. Each element:
{
  "title": "Short event title",
  "question": "Predictive question (e.g. 'What will the Fed do at the FOMC meeting?')",
  "description": "Context (asset, prior reading, consensus)",
  "starts_at": "ISO 8601 UTC",
  "resolves_at": "ISO 8601 UTC",
  "outcomes": [
    { "label": "Hold rates" },
    { "label": "Cut 25bps" },
    { "label": "Cut 50bps" }
  ],
  "metadata": { "asset": "...", "event_type": "earnings|cb|macro|ipo" }
}

CRITICAL RULES FOR OUTCOMES:
1. Outcome labels MUST be real, named entities — never positional placeholders.
   - WRONG: "Driver 1", "Team A", "Candidate A", "Nominee A"
   - RIGHT: "Max Verstappen", "Arsenal", "Chuck Schumer", "Cillian Murphy"
2. If you don't know enough about an event to name 2+ real outcomes with confidence, skip the event entirely (don't add it with placeholder outcomes).
3. For events with many possible competitors (e.g. F1, MotoGP, athletics, golf majors), list the 3-6 most likely contenders by name.
4. For head-to-head fixtures, name both sides ("Liverpool win", "Draw", "Manchester City win").
5. For tournaments, name the favourites.

Outcome labels should be directional moves or numeric ranges (e.g. "Beat consensus", "In line", "Miss"; "Hold", "Cut 25bps", "Hike 25bps"; "Above $X", "Between $X-$Y", "Below $Y"). INFORMATIONAL ONLY — never use betting language. Return as many real, scheduled events as you can find using economic calendars, earnings calendars, and central-bank schedules. If you genuinely can't find any, return [].`;

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
        },
        required: ["title", "question", "starts_at", "outcomes"],
      },
    },
  },
  required: ["events"],
} as const;

export const marketsAdapter: DomainAdapter = {
  id: DOMAIN_ID,
  displayName: "Markets",

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

    const items = safeExtractJsonArray(response.content);
    const out: DiscoveredEvent[] = [];
    for (const item of items) {
      try {
        const ev = await coerceDiscoveredEvent(item, {
          defaultMode: "prediction",
          slugPrefix: "markets",
          extraMetadata: { informationalOnly: true },
        });
        if (!ev) {
          logSkip(DOMAIN_ID, "invalid shape", item);
          continue;
        }
        // Defensive: ensure flag is set even if coerce dropped extras
        ev.metadata = { ...(ev.metadata ?? {}), informationalOnly: true };
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
            content: `You are a financial-markets results verifier. Return STRICT JSON only. Look up the official outcome of the event below and rank the outcomes from most-correct (rank 1) to least-correct. Informational only — no advice, no betting language.`,
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

  buildPrompt(event: DomainEvent, outcomes: EventOutcome[]): string {
    return `Financial-markets analysis task. INFORMATIONAL ONLY — do not give advice and do not use betting or odds framing.

Event: ${event.title}
Question: ${event.question}
Scheduled: ${event.starts_at}

Outcomes:
${outcomes.map((o, i) => `${i + 1}. ${o.label}`).join("\n")}

Rank every outcome from most likely (rank 1) to least likely. For each, provide a probability (0-1), a fit_score (0-1), and 1-3 short reasons grounded in recent data, analyst consensus, historical base rates, and current macro conditions.`;
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
