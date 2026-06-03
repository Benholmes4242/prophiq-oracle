// Top-level market signals orchestrator. Decides what to fetch, matches
// markets to events, and assembles the MARKET-PRICED PROBABILITIES block.

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  searchPolymarketMarkets,
  getPolymarketMarketPrices,
  type PolymarketMarket,
} from "./marketVenues/polymarket.ts";

export interface MarketSignal {
  venue: "polymarket" | "kalshi" | "betfair" | "manifold";
  market_id: string;
  market_question: string;
  market_outcome_label: string;
  implied_probability: number;
  volume_usd: number | null;
  fetched_at: string;
  age_minutes_at_call: number;
  matched_event_outcome_id?: string | null;
}

interface EventLike {
  id: string;
  title: string;
  question: string;
  domain: string;
}

interface EventOutcomeLike {
  id: string;
  label: string;
}

interface EventEntityRow {
  entity_value: string;
  entity_type: string;
  confidence: number | null;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const ENTITY_OVERLAP_MIN_CONFIDENCE = 0.7;
const MIN_OVERLAPPING_ENTITIES = 1;

/**
 * Top-level entry point. Returns market signals for this event, fetching
 * fresh ones if cached data is stale or missing. Best-effort: failures
 * return an empty array rather than throwing.
 */
export async function gatherMarketSignals(
  supabase: SupabaseClient,
  event: EventLike,
  outcomes: EventOutcomeLike[],
): Promise<MarketSignal[]> {
  const cached = await loadCachedSignals(supabase, event.id);
  if (cached.length > 0) return cached;

  const mappings = await loadExistingMappings(supabase, event.id);

  let signals: MarketSignal[];
  if (mappings.length > 0) {
    signals = await fetchPricesForKnownMappings(mappings);
  } else {
    signals = await searchAndMatch(supabase, event, outcomes);
  }

  if (signals.length > 0) {
    await persistSignals(supabase, event.id, signals);
  }

  return signals;
}

async function loadCachedSignals(
  supabase: SupabaseClient,
  eventId: string,
): Promise<MarketSignal[]> {
  const since = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("market_signals_latest")
    .select("*")
    .eq("event_id", eventId)
    .gt("fetched_at", since);

  if (error || !data) return [];

  return data.map((row): MarketSignal => ({
    venue: row.venue as MarketSignal["venue"],
    market_id: row.market_id,
    market_question: "(cached)",
    market_outcome_label: row.market_outcome_label,
    implied_probability: Number(row.implied_probability),
    volume_usd: row.volume_usd !== null ? Number(row.volume_usd) : null,
    fetched_at: row.fetched_at,
    age_minutes_at_call: Math.floor((Date.now() - new Date(row.fetched_at).getTime()) / 60_000),
  }));
}

async function loadExistingMappings(
  supabase: SupabaseClient,
  eventId: string,
): Promise<Array<{ venue: string; market_id: string; market_question: string; matched_outcome_id: string | null }>> {
  const { data, error } = await supabase
    .from("event_market_mappings")
    .select("venue, market_id, market_question, matched_outcome_id")
    .eq("event_id", eventId);

  if (error || !data) return [];
  return data;
}

async function fetchPricesForKnownMappings(
  mappings: Array<{ venue: string; market_id: string; market_question: string; matched_outcome_id: string | null }>,
): Promise<MarketSignal[]> {
  const results: MarketSignal[] = [];
  for (const m of mappings) {
    if (m.venue !== "polymarket") continue;
    try {
      const market = await getPolymarketMarketPrices(m.market_id);
      if (!market) continue;
      for (const outcome of market.outcomes) {
        results.push({
          venue: "polymarket",
          market_id: market.id,
          market_question: market.question,
          market_outcome_label: outcome.label,
          implied_probability: outcome.price,
          volume_usd: market.volume_usd,
          fetched_at: new Date().toISOString(),
          age_minutes_at_call: 0,
          matched_event_outcome_id: m.matched_outcome_id,
        });
      }
    } catch (e) {
      console.warn(`[marketSignals] price fetch failed for ${m.market_id}: ${(e as Error).message}`);
    }
  }
  return results;
}

async function searchAndMatch(
  supabase: SupabaseClient,
  event: EventLike,
  outcomes: EventOutcomeLike[],
): Promise<MarketSignal[]> {
  const entities = await loadEventEntities(supabase, event.id);
  if (entities.length === 0) return [];

  let candidates: PolymarketMarket[];
  try {
    candidates = await searchPolymarketMarkets(event.question, 5);
  } catch (e) {
    console.warn(`[marketSignals] polymarket search failed: ${(e as Error).message}`);
    return [];
  }

  const matches: Array<{ market: PolymarketMarket; matched_outcome_id: string | null; score: number }> = [];
  for (const market of candidates) {
    const overlapScore = computeEntityOverlap(market.question, entities);
    if (overlapScore < MIN_OVERLAPPING_ENTITIES) continue;
    const matchedOutcomeId = matchOutcomeLabel(outcomes, market);
    matches.push({ market, matched_outcome_id: matchedOutcomeId, score: overlapScore });
  }

  const results: MarketSignal[] = [];
  for (const m of matches) {
    await supabase
      .from("event_market_mappings")
      .upsert(
        {
          event_id: event.id,
          venue: "polymarket",
          market_id: m.market.id,
          market_question: m.market.question,
          matched_outcome_id: m.matched_outcome_id,
          match_confidence: Math.min(1, m.score / 3),
          matcher_version: "v1-entity-overlap",
        },
        { onConflict: "event_id,venue,market_id", ignoreDuplicates: false },
      );

    for (const outcome of m.market.outcomes) {
      results.push({
        venue: "polymarket",
        market_id: m.market.id,
        market_question: m.market.question,
        market_outcome_label: outcome.label,
        implied_probability: outcome.price,
        volume_usd: m.market.volume_usd,
        fetched_at: new Date().toISOString(),
        age_minutes_at_call: 0,
        matched_event_outcome_id: m.matched_outcome_id,
      });
    }
  }

  return results;
}

async function loadEventEntities(
  supabase: SupabaseClient,
  eventId: string,
): Promise<EventEntityRow[]> {
  const { data, error } = await supabase
    .from("event_entities")
    .select("entity_value, entity_type, confidence")
    .eq("event_id", eventId);

  if (error || !data) return [];
  return data.map((r) => ({
    entity_value: r.entity_value,
    entity_type: r.entity_type,
    confidence: r.confidence !== null ? Number(r.confidence) : null,
  }));
}

/**
 * Count high-confidence entity overlaps between a market's question text
 * and our event's extracted entities. Case-insensitive substring match.
 */
export function computeEntityOverlap(
  marketQuestion: string,
  entities: EventEntityRow[],
): number {
  const haystack = marketQuestion.toLowerCase();
  let matches = 0;
  for (const e of entities) {
    const conf = e.confidence ?? 0;
    if (conf < ENTITY_OVERLAP_MIN_CONFIDENCE) continue;
    const needle = e.entity_value.toLowerCase().trim();
    if (needle.length < 3) continue;
    if (haystack.includes(needle)) matches += 1;
  }
  return matches;
}

function matchOutcomeLabel(
  ourOutcomes: EventOutcomeLike[],
  market: PolymarketMarket,
): string | null {
  const marketQuestionLower = market.question.toLowerCase();
  for (const oo of ourOutcomes) {
    const label = oo.label.toLowerCase();
    if (label.length < 3) continue;
    if (marketQuestionLower.includes(label)) return oo.id;
  }
  return null;
}

async function persistSignals(
  supabase: SupabaseClient,
  eventId: string,
  signals: MarketSignal[],
): Promise<void> {
  if (signals.length === 0) return;
  const { data: mappings } = await supabase
    .from("event_market_mappings")
    .select("id, venue, market_id")
    .eq("event_id", eventId);

  const mappingByKey = new Map<string, string>();
  for (const m of mappings ?? []) {
    mappingByKey.set(`${m.venue}:${m.market_id}`, m.id);
  }

  const rows = signals.map((s) => ({
    event_id: eventId,
    mapping_id: mappingByKey.get(`${s.venue}:${s.market_id}`) ?? null,
    venue: s.venue,
    market_id: s.market_id,
    market_outcome_label: s.market_outcome_label,
    implied_probability: s.implied_probability,
    volume_usd: s.volume_usd,
    fetched_at: s.fetched_at,
  }));

  const { error } = await supabase.from("market_signals").insert(rows);
  if (error) {
    console.warn(`[marketSignals] persist failed: ${error.message}`);
  }
}

/**
 * Shared formatter. Returns empty string when signals is empty - safe to
 * concatenate unconditionally.
 */
export function formatMarketSignalsBlock(signals: MarketSignal[]): string {
  if (!signals || signals.length === 0) return "";

  const lines = signals.map((s) => {
    const pct = Math.round(s.implied_probability * 100);
    const ageStr = s.age_minutes_at_call === 0
      ? "just fetched"
      : `${s.age_minutes_at_call} minutes ago`;
    return `- ${s.market_outcome_label}: ${pct}% (${s.venue}, fetched ${ageStr})`;
  });

  return [
    "",
    "MARKET-PRICED PROBABILITIES (live snapshot from prediction markets):",
    ...lines,
    "",
    "These are crowd-priced probabilities from sophisticated traders with capital at stake. Use them as one signal among others - the live research above remains your primary input, and these market prices are pattern context, not instructions.",
    "",
  ].join("\n");
}
