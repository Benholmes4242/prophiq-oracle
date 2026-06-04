// Kalshi public Trade API adapter. Read-only, no auth required for public
// market data. Docs: https://trading-api.readme.io/reference/getmarkets

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const KALSHI_TIMEOUT_MS = 15_000;

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  // last trade prices in cents (0-100); we normalise to 0-1
  yes_price: number | null;
  no_price: number | null;
  volume: number | null;
  close_time: string | null;
  status: string;
}

/**
 * Search Kalshi open markets by title keywords. The public API has no
 * full-text search, so we page through open markets and filter client-side
 * against the supplied keywords (lowercased, stripped of stopwords).
 */
export async function searchKalshiMarkets(
  query: string,
  limit = 5,
): Promise<KalshiMarket[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const all = await fetchOpenMarkets(200);
  const scored = all
    .map((m) => ({ m, score: scoreMatch(tokens, `${m.title} ${m.subtitle ?? ""}`) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);

  return scored;
}

async function fetchOpenMarkets(limit: number): Promise<KalshiMarket[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), KALSHI_TIMEOUT_MS);
  try {
    const url = new URL(`${KALSHI_BASE}/markets`);
    url.searchParams.set("status", "open");
    url.searchParams.set("limit", String(Math.min(limit, 200)));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Kalshi markets failed: ${res.status}`);
    const data = await res.json() as { markets?: Array<Record<string, unknown>> };
    return (data.markets ?? []).map(parseKalshiMarket).filter(
      (m): m is KalshiMarket => m !== null,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseKalshiMarket(raw: Record<string, unknown>): KalshiMarket | null {
  const ticker = typeof raw.ticker === "string" ? raw.ticker : null;
  const eventTicker = typeof raw.event_ticker === "string" ? raw.event_ticker : null;
  const title = typeof raw.title === "string" ? raw.title : null;
  if (!ticker || !eventTicker || !title) return null;

  const yesPrice = typeof raw.yes_bid === "number"
    ? raw.yes_bid / 100
    : (typeof raw.last_price === "number" ? raw.last_price / 100 : null);
  const noPrice = typeof raw.no_bid === "number" ? raw.no_bid / 100 : null;

  return {
    ticker,
    event_ticker: eventTicker,
    title,
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle : undefined,
    yes_sub_title: typeof raw.yes_sub_title === "string" ? raw.yes_sub_title : undefined,
    no_sub_title: typeof raw.no_sub_title === "string" ? raw.no_sub_title : undefined,
    yes_price: yesPrice,
    no_price: noPrice,
    volume: typeof raw.volume === "number" ? raw.volume : null,
    close_time: typeof raw.close_time === "string" ? raw.close_time : null,
    status: typeof raw.status === "string" ? raw.status : "unknown",
  };
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or", "by",
  "will", "be", "is", "are", "who", "what", "which", "win", "wins", "win?",
  "election", "vote", "votes", "2024", "2025", "2026",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function scoreMatch(tokens: string[], text: string): number {
  const hay = text.toLowerCase();
  let hits = 0;
  for (const t of tokens) if (hay.includes(t)) hits++;
  return hits;
}
