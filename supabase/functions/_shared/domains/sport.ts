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
  STRUCTURED_DATA_TIMEOUT_MS,
  type StructuredData,
  type StructuredDataContext,
  type StructuredDataError,
  type StructuredDataSource,
  withTimeout,
} from "../structuredData.ts";
import { fetchTheSportsDBContext } from "../dataSources/theSportsDB.ts";
import { groundSportEventForCron, type SportKind } from "../dataSources/sportGrounding.ts";
import {
  apiSportsVersionTag,
  getHeadToHead,
  getTeamRecentForm,
  searchTeamByName,
  type ApiSportsFixture,
} from "../dataSources/apiSports.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { coerceDiscoveredEvent, isFeedlessSportTitle, logSkip, safeExtractJsonArray } from "./_util.ts";
import { forecastDisciplineBlock } from "../forecastDiscipline.ts";

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
  "metadata": {
    "league": "...",
    "sport": "...",
    "sub_category": "REQUIRED. One of: horse_racing, football, basketball, baseball, american_football, hockey, golf, tennis, f1, mma, cricket, college_sports, other",
    "favorite_label": "Name of the most likely winner (must exactly match one of the outcome labels), or null if the field/favorite isn't yet identifiable",
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
- field_size is the integer count of contestants/outcomes (use outcomes.length when uncertain).

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
                        metadata: {
                          type: "object",
                          properties: {
                            sub_category: { type: "string" },
                            favorite_label: { type: ["string", "null"] },
                            field_size: { type: "integer" },
                            league: { type: "string" },
                            sport: { type: "string" },
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
    console.log(`[domain:${DOMAIN_ID}] raw response preview:`, response.content.slice(0, 800));
    console.log(`[domain:${DOMAIN_ID}] parsed event[0] keys:`, items[0] && typeof items[0] === "object" ? Object.keys(items[0] as object) : null, "metadata:", JSON.stringify((items[0] as { metadata?: unknown } | undefined)?.metadata));
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
        // Fix 2 (feed-gate): refuse to persist sports we have no real feed
        // for. Horse racing in particular is pure LLM recall today and
        // accounts for most fabricated events / placeholder outcomes.
        if (isFeedlessSportTitle({ title: ev.title, metadata: ev.metadata })) {
          logSkip(DOMAIN_ID, "feed-less sub-category (no wired data source)", item);
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
    structuredData?: StructuredData | null,
  ): string {
    const oddsHint = mode === "odds"
      ? "Frame your analysis in terms of bookmaker-style implied probabilities and fair odds. Justify each rank with what the market should price."
      : "";
    const researchBlock = research?.synthesised
      ? `\nLIVE RESEARCH CONTEXT (fetched ${research.fetched_at}):\n${research.synthesised}\n`
      : "";
    const priorBlock = formatPriorBlock(priors ?? []);
    const marketBlock = formatMarketSignalsBlock(marketSignals ?? []);
    const structuredBlock = formatStructuredDataBlock(structuredData ?? null);
    return `Sports analysis task.

Event: ${event.title}
Question: ${event.question}
Kickoff: ${event.starts_at}

Outcomes:
${outcomes.map((o, i) => `${i + 1}. ${o.label}`).join("\n")}
${researchBlock}${priorBlock}${marketBlock}${structuredBlock}
${oddsHint}

Use the structured data above as authoritative factual ground truth where present. The live research and market signals are useful context. Rank every outcome from most likely (rank 1) to least likely. For each, provide a probability (0-1), a fit_score (0-1) for how strongly the data supports it, and 1-3 short reasons grounded in form, head-to-head, injuries, venue, and the research above.
${forecastDisciplineBlock()}`;
  },

  async gatherStructuredData(
    supabase: SupabaseClient,
    event: DomainEvent,
    _outcomes: EventOutcome[],
  ): Promise<StructuredData | null> {
    try {
      return await gatherFootballStructuredData(supabase, event);
    } catch (e) {
      console.warn(`[sportAdapter] structured data fetch failed: ${(e as Error).message}`);
      return null;
    }
  },

  async gatherStructuredSources(
    _supabase,
    event: DomainEvent,
    _outcomes: EventOutcome[],
  ): Promise<StructuredDataContext> {
    const t0 = Date.now();
    const tsdbKey = readEnv("THESPORTSDB_API_KEY") ?? "";
    const hints = {
      metadata: event.metadata as Record<string, unknown> | null,
      title: event.title,
      question: event.question,
      starts_at: event.starts_at,
    };

    const football = isFootballEvent(event);
    const horseRacing = isHorseRacingEvent(event);
    const golf = isGolfEvent(event);
    const tennis = isTennisEvent(event);

    const sources: StructuredDataSource[] = [];
    const errors: StructuredDataError[] = [];
    let groundedOutcomes: string[] | undefined;

    // ====================================================================
    // Sport grounding (Step 3): one shared module produces feed-backed
    // outcomes + grounding sources for football / golf / horse racing /
    // tennis (match winner). Both submit-question and the cron route
    // through groundSportEvent so a discovered event gets the SAME real
    // runners / teams / players as the same question typed. Replaces the
    // old fetchFootballDataContext / fetchRacingContext / fetchGolfContext
    // call sites AND the event.metadata.football_confirm passthrough block.
    //
    // CLEAN RETURN: grounded outcomes are returned via the optional
    // `groundedOutcomes` field on StructuredDataContext. The cron
    // caller (generate-prediction) swaps them in for the prompt +
    // consensus. NO mid-pipeline event_outcomes write here — that was
    // the prior workaround. gatherStructuredSources is a read-shaped
    // gather function and must not mutate the DB as a side effect.
    // ====================================================================
    const groundingSport: SportKind | null =
      football ? "football"
      : (golf && !horseRacing) ? "golf"
      : horseRacing ? "horse_racing"
      : tennis ? "tennis"
      : null;

    if (groundingSport) {
      try {
        const meta = (typeof event.metadata === "object" && event.metadata !== null)
          ? (event.metadata as Record<string, unknown>)
          : {};
        const rawCompetitors = meta.competitors;
        const competitors: string[] | null = Array.isArray(rawCompetitors)
          ? rawCompetitors.map((c) => String(c)).filter((s) => s.trim().length > 0)
          : null;
        const approxDate = event.starts_at
          ? new Date(event.starts_at).toISOString().slice(0, 10)
          : null;

        const cron = await groundSportEventForCron({
          sport: groundingSport,
          canonicalEvent: event.title,
          approxDate,
          competitors: competitors && competitors.length > 0 ? competitors : null,
        });

        for (const s of cron.sources) {
          sources.push({
            name: s.name,
            data: s.data,
            fetched_at: s.fetched_at,
            duration_ms: s.duration_ms,
          });
        }

        // Surface grounded outcomes (favourite-first, bucketed long tail)
        // via the return value. The caller decides whether/how to use them.
        if (cron.outcomes && cron.outcomes.length > 0) {
          groundedOutcomes = bucketGroundedOutcomes(cron.outcomes, cron.isGolf);
        }
      } catch (e) {
        console.warn(
          `[sport.gatherStructuredSources] grounding failed for event ${event.id}: ${(e as Error).message}`,
        );
      }
    }

    // theSportsDB stays as fallback for non-confirm sports (rugby, cricket,
    // etc.) and props. Football / golf / horse racing / tennis are served by
    // groundSportEventForCron above.
    const tasks: Array<Promise<SourceResult>> = [];
    if (!football && !golf && !horseRacing && !tennis) {
      tasks.push(runSource("theSportsDB", () => fetchTheSportsDBContext(tsdbKey, hints)));
    }

    const settled = await Promise.allSettled(tasks);
    for (const res of settled) {
      if (res.status === "fulfilled") {
        if (res.value.kind === "ok") sources.push(res.value.source);
        else if (res.value.kind === "err") errors.push(res.value.error);
      } else {
        errors.push({
          source: "unknown",
          message: (res.reason as Error)?.message ?? "rejected",
          duration_ms: 0,
        });
      }
    }

    return { sources, errors, total_duration_ms: Date.now() - t0, groundedOutcomes };
  },
};

// ============================================================
// Truncate a long field to a named head + a single bucket tail
// ("Any other player" / "Any other runner"). Pure helper; no I/O.
// ============================================================
function bucketGroundedOutcomes(outcomes: string[], isGolf: boolean): string[] {
  const MAX_NAMED = 8;
  if (outcomes.length <= MAX_NAMED) return [...outcomes];
  const head = outcomes.slice(0, MAX_NAMED);
  head.push(isGolf ? "Any other player" : "Any other runner");
  return head;
}

type SourceResult =
  | { kind: "ok"; source: StructuredDataSource }
  | { kind: "empty"; source: string; duration_ms: number }
  | { kind: "err"; error: StructuredDataError };

async function runSource(
  name: string,
  fetcher: () => Promise<unknown>,
): Promise<SourceResult> {
  const start = Date.now();
  try {
    const data = await withTimeout(fetcher(), STRUCTURED_DATA_TIMEOUT_MS, name);
    const duration_ms = Date.now() - start;
    if (!hasUsableData(data)) {
      return { kind: "empty", source: name, duration_ms };
    }
    return {
      kind: "ok",
      source: { name, data, fetched_at: new Date().toISOString(), duration_ms },
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

/**
 * Bug 1 fix: classify a feed payload as usable or empty. Both footballData
 * and theSportsDB return success-with-no-data on a miss (e.g.
 * `{ matched: null, events: [], note: "no events found" }`). Those payloads
 * must not count as a real structured-data source — otherwise the trust
 * layer mis-labels the forecast `feed_backed` and skips the no-fabrication
 * discipline block.
 */
function hasUsableData(data: unknown): boolean {
  if (data === null || data === undefined) return false;
  if (typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if ("matched" in d || "events" in d || "candidates" in d) {
    if (d.matched !== null && d.matched !== undefined) return true;
    const events = Array.isArray((d as { events?: unknown[] }).events)
      ? (d as { events: unknown[] }).events
      : [];
    if (events.length > 0) return true;
    return false;
  }
  // Unknown shape: only count it if it has at least one non-note key.
  const keys = Object.keys(d).filter((k) => k !== "note");
  return keys.length > 0;
}

export function isHorseRacingEvent(event: DomainEvent): boolean {
  const meta = (typeof event.metadata === "object" && event.metadata !== null)
    ? (event.metadata as Record<string, unknown>)
    : {};
  // 1. Authoritative: trust sub_category from discovery (schema uses
  //    `sub_category`; older code wrote `subcategory` — accept both).
  const subCat = String(meta.sub_category ?? meta.subcategory ?? "")
    .toLowerCase().trim();
  if (subCat === "horse_racing" || subCat === "horseracing") return true;

  const text = [
    event.title,
    event.question,
    String(meta.subcategory ?? ""),
    String(meta.sub_category ?? ""),
    String(meta.sport ?? ""),
    String(meta.league ?? ""),
  ].join(" ").toLowerCase();
  if (/\bhorse[ _-]?racing\b/.test(text)) return true;
  if (/\bracecourse\b|\bgallop(s|ing)?\b|\bjockey\b|\bsteeplechase\b|\bhurdle\b/.test(text)) return true;
  // Expanded UK/IE/AU/US racing venues
  if (/\b(hexham|cheltenham|aintree|ascot|epsom|newmarket|goodwood|sandown|kempton|doncaster|chester|york|wetherby|lingfield|wolverhampton|southwell|roscommon|windsor|pontefract|carlisle|leicester|beverley|brighton|catterick|hamilton|musselburgh|newcastle|nottingham|redcar|ripon|salisbury|thirsk|uttoxeter|bath|ayr|ballinrobe|cork|galway|gowran park|killarney|limerick|listowel|naas|navan|sligo|thurles|tipperary|tramore|wexford|down royal|downpatrick|dundalk|bellewstown|clonmel|kilbeggan|laytown|leopardstown|punchestown|fairyhouse|curragh|flemington|churchill downs|belmont|saratoga|santa anita|del mar|gulfstream|keeneland|aqueduct|pimlico|parx|finger lakes|louisiana downs|mountaineer|presque isle|prairie meadows|thistledown|monmouth|oaklawn|fair grounds|tampa bay downs|golden gate|woodbine|melbourne cup|grand national|kentucky derby)\b/.test(text)) return true;
  // Race-card time-of-day pattern. Allow one optional non-"at" word between
  // the time and "at" to absorb words like "race"/"fixture":
  // "3:45 at Hexham", "17:18 race at Roscommon", "5:18 fixture at Windsor".
  if (/\b\d{1,2}[:.]\d{2}\s+(?:(?!at\b)\w+\s+)?at\s+[a-z]/i.test(text)) return true;
  // Best-effort: word "race"/"races" + a TIME + "at <place>" shape together.
  if (/\brace(s)?\b/.test(text) && /\b\d{1,2}[:.]\d{2}\b/.test(text) && /\bat\s+[a-z]/i.test(text)) return true;
  return false;
}

export function isGolfEvent(event: DomainEvent): boolean {
  const meta = (typeof event.metadata === "object" && event.metadata !== null)
    ? (event.metadata as Record<string, unknown>)
    : {};
  const subCat = String(meta.sub_category ?? meta.subcategory ?? "")
    .toLowerCase().trim();
  if (subCat === "golf") return true;

  const text = [
    event.title,
    event.question,
    String(meta.subcategory ?? ""),
    String(meta.sub_category ?? ""),
    String(meta.sport ?? ""),
    String(meta.league ?? ""),
  ].join(" ").toLowerCase();

  // Strong golf signals (tour names, well-known golf-only majors/events).
  if (/\bgolf\b/.test(text)) return true;
  if (/\b(pga tour|pga championship|dp world|european tour|lpga|korn ferry|ryder cup|presidents cup|liv golf|champions tour|senior pga|senior tour)\b/.test(text)) return true;
  if (/\bwomen'?s\s+(open|championship|major)\b/.test(text)) return true;
  if (/\b(the masters|masters tournament|the open championship|british open|memorial tournament|players championship|tour championship|fedex ?cup|arnold palmer invitational|wgc|wells fargo|wyndham championship|travelers championship|john deere classic|rocket mortgage|sentry tournament|farmers insurance|waste management|phoenix open|valspar|valero|zurich classic|charles schwab|rbc|genesis invitational|hero world challenge)\b/.test(text)) return true;
  // "US Open" alone is ambiguous (tennis). Require an explicit golf signal,
  // which the rules above already enforce — so do not match bare "us open".
  return false;
}

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}


// ============================================================
// Football structured-data helpers
// ============================================================

function isFootballEvent(event: DomainEvent): boolean {
  const text = [
    event.title,
    event.question,
    typeof event.metadata === "object" && event.metadata !== null
      ? String((event.metadata as Record<string, unknown>).subcategory ?? "") +
        " " +
        String((event.metadata as Record<string, unknown>).sport ?? "") +
        " " +
        String((event.metadata as Record<string, unknown>).league ?? "")
      : "",
  ].join(" ").toLowerCase();

  const negativeKeywords = [
    "nfl", "american football", "super bowl",
    "nba", "basketball",
    "tennis", "wimbledon", "us open", "french open", "australian open",
    "golf", "pga", "masters", "ryder cup",
    "f1", "formula 1", "grand prix",
    "ufc", "mma", "boxing",
    "cricket", "ipl", "ashes",
    "rugby",
  ];
  for (const k of negativeKeywords) if (text.includes(k)) return false;

  const positiveKeywords = [
    "premier league", "la liga", "serie a", "bundesliga", "ligue 1",
    "champions league", "europa league", "fa cup",
    "world cup", "uefa", "fifa", "concacaf", "afcon", "copa america",
    "mls", "championship", "carabao cup", "football", "soccer",
  ];
  for (const k of positiveKeywords) if (text.includes(k)) return true;

  return false;
}

function extractTeamNamesFromQuestion(
  event: DomainEvent,
): { teamA: string; teamB: string } | null {
  const text = `${event.title} ${event.question}`;
  const vMatch = text.match(/(.+?)\s+(?:v|vs|vs\.|versus)\s+(.+?)(?:\s*[\(\-\?]|$)/i);
  if (vMatch) {
    return { teamA: vMatch[1].trim(), teamB: vMatch[2].trim() };
  }
  return null;
}

async function gatherFootballStructuredData(
  supabase: SupabaseClient,
  event: DomainEvent,
): Promise<StructuredData | null> {
  if (!isFootballEvent(event)) return null;

  const cached = await loadCachedStructuredData(supabase, event.id, apiSportsVersionTag);
  if (cached) return cached;

  const teams = extractTeamNamesFromQuestion(event);
  if (!teams) return null;

  const [teamA, teamB] = await Promise.all([
    searchTeamByName(teams.teamA),
    searchTeamByName(teams.teamB),
  ]);
  if (!teamA || !teamB) return null;

  const [formA, formB, h2h] = await Promise.all([
    getTeamRecentForm(teamA.id, 5),
    getTeamRecentForm(teamB.id, 5),
    getHeadToHead(teamA.id, teamB.id, 5),
  ]);

  const lines: string[] = [];
  lines.push(
    `${teamA.name} recent form (last 5): ${summariseFootballForm(formA, teamA.id)}`,
  );
  lines.push(
    `${teamB.name} recent form (last 5): ${summariseFootballForm(formB, teamB.id)}`,
  );
  if (h2h.length > 0) {
    lines.push(
      `Head-to-head (last ${h2h.length}): ${summariseFootballH2H(h2h, teamA, teamB)}`,
    );
  }

  if (lines.length === 0) return null;

  const data: StructuredData = {
    source: apiSportsVersionTag,
    source_version: "v3",
    fetched_at: new Date().toISOString(),
    payload: {
      team_a: { id: teamA.id, name: teamA.name, recent_form: formA },
      team_b: { id: teamB.id, name: teamB.name, recent_form: formB },
      head_to_head: h2h,
    },
    summary_lines: lines,
  };

  await persistStructuredData(supabase, event.id, data);
  return data;
}

function summariseFootballForm(fixtures: ApiSportsFixture[], teamId: number): string {
  if (fixtures.length === 0) return "no recent data available";
  const parts: string[] = [];
  for (const f of fixtures) {
    const isHome = f.home_team.id === teamId;
    const teamGoals = isHome ? f.home_goals : f.away_goals;
    const oppGoals = isHome ? f.away_goals : f.home_goals;
    const opponent = isHome ? f.away_team.name : f.home_team.name;
    if (teamGoals === null || oppGoals === null) continue;

    const result = teamGoals > oppGoals ? "W" : teamGoals < oppGoals ? "L" : "D";
    parts.push(`${result} ${teamGoals}-${oppGoals} vs ${opponent}`);
  }
  return parts.length > 0 ? parts.join("; ") : "no recent results parsed";
}

function summariseFootballH2H(
  fixtures: ApiSportsFixture[],
  teamA: { id: number; name: string },
  teamB: { id: number; name: string },
): string {
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  const recentScores: string[] = [];
  for (const f of fixtures) {
    if (f.home_goals === null || f.away_goals === null) continue;
    const aIsHome = f.home_team.id === teamA.id;
    const aGoals = aIsHome ? f.home_goals : f.away_goals;
    const bGoals = aIsHome ? f.away_goals : f.home_goals;
    if (aGoals > bGoals) aWins += 1;
    else if (aGoals < bGoals) bWins += 1;
    else draws += 1;
    recentScores.push(`${aGoals}-${bGoals}`);
  }
  return `${teamA.name} ${aWins}W ${draws}D ${bWins}L ${teamB.name} (recent scores ${teamA.name} perspective: ${recentScores.slice(0, 3).join(", ")})`;
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
