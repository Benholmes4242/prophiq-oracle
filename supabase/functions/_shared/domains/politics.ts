// Politics domain adapter. Prediction-only (NO odds/betting framing).
// Discovers upcoming political events (elections, votes, confirmations,
// leadership contests) and resolves outcomes via Perplexity.

import type {
  DiscoveredEvent,
  DomainAdapter,
  DomainEvent,
  EventOutcome,
  ResolutionResult,
} from "../domain.ts";
import { perplexityChat } from "../perplexity.ts";
import { coerceDiscoveredEvent, logSkip, safeExtractJsonArray } from "./_util.ts";

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
  "metadata": { "country": "...", "type": "election|vote|leadership" }
}

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
        },
        required: ["title", "question", "starts_at", "outcomes"],
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

    const items = safeExtractJsonArray(response.content);
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

  buildPrompt(event: DomainEvent, outcomes: EventOutcome[]): string {
    return `Political analysis task. Use neutral, non-partisan language. Do NOT use betting or odds framing.

Event: ${event.title}
Question: ${event.question}
Date: ${event.starts_at}

Outcomes:
${outcomes.map((o, i) => `${i + 1}. ${o.label}`).join("\n")}

Rank every outcome from most likely (rank 1) to least likely. For each, provide a probability (0-1), a fit_score (0-1), and 1-3 short reasons grounded in polling, recent statements, historical base rates, and current political dynamics.`;
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
