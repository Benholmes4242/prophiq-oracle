// Polymarket Gamma API adapter. Read-only, no auth required.
// Documentation: https://docs.polymarket.com/

const POLYMARKET_GAMMA_BASE = "https://gamma-api.polymarket.com";
const POLYMARKET_TIMEOUT_MS = 15_000;

export interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  outcomes: Array<{ label: string; price: number }>;
  volume_usd: number | null;
  end_date: string | null;
  closed: boolean;
}

/**
 * Search Polymarket markets by query string. Returns up to `limit` candidates
 * ordered by Polymarket's own relevance score.
 */
export async function searchPolymarketMarkets(
  query: string,
  limit = 5,
): Promise<PolymarketMarket[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), POLYMARKET_TIMEOUT_MS);

  let res: Response;
  try {
    const url = new URL(`${POLYMARKET_GAMMA_BASE}/markets`);
    url.searchParams.set("search", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");

    res = await fetch(url.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`Polymarket search failed: ${res.status}`);
  }

  const data = await res.json() as Array<Record<string, unknown>>;
  return (Array.isArray(data) ? data : [])
    .map(parsePolymarketMarket)
    .filter((m): m is PolymarketMarket => m !== null);
}

function parsePolymarketMarket(raw: Record<string, unknown>): PolymarketMarket | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  const question = typeof raw.question === "string" ? raw.question : null;
  const slug = typeof raw.slug === "string" ? raw.slug : null;
  if (!id || !question || !slug) return null;

  const outcomeLabelsRaw = typeof raw.outcomes === "string" ? raw.outcomes : "";
  const pricesRaw = typeof raw.outcomePrices === "string" ? raw.outcomePrices : "";

  let labels: string[] = [];
  let prices: number[] = [];
  try { labels = JSON.parse(outcomeLabelsRaw); } catch { /* ignore */ }
  try { prices = JSON.parse(pricesRaw).map((p: string) => Number(p)); } catch { /* ignore */ }

  if (labels.length === 0 || labels.length !== prices.length) return null;

  const outcomes = labels.map((label, i) => ({
    label: String(label),
    price: typeof prices[i] === "number" ? prices[i] : 0,
  }));

  const volumeUsd = typeof raw.volume === "number"
    ? raw.volume
    : (typeof raw.volume === "string" ? (Number(raw.volume) || null) : null);

  return {
    id,
    question,
    slug,
    outcomes,
    volume_usd: volumeUsd,
    end_date: typeof raw.endDate === "string" ? raw.endDate : null,
    closed: raw.closed === true,
  };
}

/**
 * Fetch the latest prices for a known Polymarket market_id. Used when we
 * have a stored mapping and want fresh prices without re-running search.
 */
export async function getPolymarketMarketPrices(marketId: string): Promise<PolymarketMarket | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), POLYMARKET_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${POLYMARKET_GAMMA_BASE}/markets/${encodeURIComponent(marketId)}`, {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Polymarket fetch failed: ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return parsePolymarketMarket(data);
}
