// Sport domain adapter. Discovers upcoming fixtures and resolves final
// scores/winners via Perplexity. Sport is the ONLY domain that supports
// odds-mode framing.

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
  loadCachedStructuredData,
  persistStructuredData,
  type StructuredData,
} from "../structuredData.ts";
import {
  apiSportsVersionTag,
  getHeadToHead,
  getTeamRecentForm,
  searchTeamByName,
  type ApiSportsFixture,
} from "../dataSources/apiSports.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { coerceDiscoveredEvent, logSkip, safeExtractJsonArray } from "./_util.ts";

const RESEARCH_PROMPT_VERSION = "sport.research.v1";

const RESEARCH_SYSTEM = `You are a sports analyst providing concise pre-match research. Return ONLY the research findings as 4-6 short paragraphs of plain prose. No preamble, no markdown headers, no bullet points unless they're inline within a sentence.`;

function buildSportResearchUser(event: DomainEvent, outcomes: EventOutcome[]): string {
  const labels = outcomes.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  return `Research the following upcoming sporting event:

Event: ${event.title}
Question: ${event.question}
Scheduled: ${event.starts_at}

Outcomes being considered:
${labels}

In 200-400 words, cover anything material to forecasting the outcome:
- Recent form of each named contender (last 3-5 outings)
- Head-to-head record if applicable
- Notable injuries, suspensions, or absences
- Venue, weather, or surface factors where relevant
- Betting market signals if publicly available (do not name specific bookmakers)
- Any breaking news from the last 7 days that bears on the contest

Be factual. Cite specific recent events and dates inline. Do not speculate beyond what current public information supports. Do not produce a prediction yourself - just the research a good analyst would assemble.`;
}

const DOMAIN_ID = "sport";

export const DISCOVERY_SYSTEM = `You are a sports research assistant. Return STRICT JSON only — no prose, no markdown fences. Identify upcoming, scheduled sporting events (any major league/competition) in the next 7 days. For each event include 2-3 outcomes (typically home win / draw / away win, or competitor names for individual sports).`;

export const DISCOVERY_USER = (now: Date) => `It is currently early June 2026. Find sporting events between today and one week from today (June 1-8, 2026).

List upcoming scheduled sporting events between ${now.toISOString()} and ${new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()}.

Return a JSON array. Each element:
{
  "title": "Team A vs Team B - Competition",
  "question": "Who will win Team A vs Team B?",
  "description": "Brief context (league, round, venue)",
  "starts_at": "ISO 8601 UTC",
  "resolves_at": "ISO 8601 UTC (typically start + 3-4h)",
  "outcomes": [
    // Head-to-head: { "label": "Liverpool win" }, { "label": "Draw" }, { "label": "Manchester City win" }
    // Race/tournament: { "label": "Max Verstappen" }, { "label": "Lando Norris" }, { "label": "Charles Leclerc" }, { "label": "Lewis Hamilton" }
    // Athletics: { "label": "Noah Lyles" }, { "label": "Letsile Tebogo" }, { "label": "Kishane Thompson" }
  ],
  "metadata": { "league": "...", "sport": "..." }
}

CRITICAL RULES FOR OUTCOMES:
1. Outcome labels MUST be real, named entities — never positional placeholders.
   - WRONG: "Driver 1", "Team A", "Candidate A", "Nominee A"
   - RIGHT: "Max Verstappen", "Arsenal", "Chuck Schumer", "Cillian Murphy"
2. If you don't know enough about an event to name 2+ real outcomes with confidence, skip the event entirely (don't add it with placeholder outcomes).
3. For events with many possible competitors (e.g. F1, MotoGP, athletics, golf majors), list the 3-6 most likely contenders by name.
4. For head-to-head fixtures, name both sides ("Liverpool win", "Draw", "Manchester City win").
5. For tournaments, name the favourites.

Return as many real, scheduled events as you can find in this window. Use fixture lists, official league schedules, and pre-event coverage. If you genuinely can't find any, return [].`;

export const sportAdapter: DomainAdapter = {
  id: DOMAIN_ID,
  displayName: "Sport",

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
            json_schema: {
              schema: {
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
              },
            },
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
          defaultMode: "both", // sport supports odds AND prediction
          slugPrefix: "sport",
          extraMetadata: { supportsOddsMode: true },
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
            content: `You are a sports results verifier. Return STRICT JSON only. Look up the FINAL official result of the event below and rank the outcomes from most-correct (rank 1) to least-correct.`,
          },
          {
            role: "user",
            content: `Event: ${event.title}\nQuestion: ${event.question}\nScheduled: ${event.starts_at}\n\nOutcomes:\n${labels}\n\nReturn JSON:\n{ "rankings": [ { "label": "<exact label>", "rank": 1 } ], "context": "Final score / brief verification" }\n\nIf the event has not been played yet or you cannot verify the result, return { "rankings": [], "context": "unresolved" }.`,
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
      userPrompt: buildSportResearchUser(event, outcomes),
      researchPromptVersion: RESEARCH_PROMPT_VERSION,
      recencyFilter: "week",
      maxTokens: 800,
    });
  },

  buildPrompt(
    event: DomainEvent,
    outcomes: EventOutcome[],
    mode: "prediction" | "odds" = "prediction",
    research?: ResearchContext,
    priors?: PriorContext[],
    marketSignals?: MarketSignal[],
  ): string {
    const oddsHint = mode === "odds"
      ? "Frame your analysis in terms of bookmaker-style implied probabilities and fair odds. Justify each rank with what the market should price."
      : "";
    const researchBlock = research?.synthesised
      ? `\nLIVE RESEARCH CONTEXT (fetched ${research.fetched_at}):\n${research.synthesised}\n`
      : "";
    const priorBlock = formatPriorBlock(priors ?? []);
    const marketBlock = formatMarketSignalsBlock(marketSignals ?? []);
    return `Sports analysis task.

Event: ${event.title}
Question: ${event.question}
Kickoff: ${event.starts_at}

Outcomes:
${outcomes.map((o, i) => `${i + 1}. ${o.label}`).join("\n")}
${researchBlock}${priorBlock}${marketBlock}
${oddsHint}

Use the live research context above (when present) as your primary input. Rank every outcome from most likely (rank 1) to least likely. For each, provide a probability (0-1), a fit_score (0-1) for how strongly the data supports it, and 1-3 short reasons grounded in form, head-to-head, injuries, venue, and the research above.`;
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
