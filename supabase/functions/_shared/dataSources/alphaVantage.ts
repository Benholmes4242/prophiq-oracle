// Alpha Vantage adapter. Read-only public API (free tier 25 calls/day).
// Docs: https://www.alphavantage.co/documentation/
//
// Brief GG: best-effort context for markets events. We try to infer a
// ticker symbol from event metadata (instrument/asset/symbol) or the
// title, then fetch GLOBAL_QUOTE for a current price snapshot. Falls back
// gracefully when no symbol is identifiable.

const AV_BASE = "https://www.alphavantage.co/query";
const AV_TIMEOUT_MS = 10_000;

export interface AlphaVantageQuote {
  symbol: string;
  price: number | null;
  change: number | null;
  change_percent: string | null;
  volume: number | null;
  latest_trading_day: string | null;
  previous_close: number | null;
}

export interface AlphaVantageSnapshot {
  symbol: string | null;
  quote: AlphaVantageQuote | null;
  note?: string;
}

export async function fetchAlphaVantageContext(
  apiKey: string,
  hints: { metadata?: Record<string, unknown> | null; title?: string; question?: string },
): Promise<AlphaVantageSnapshot> {
  if (!apiKey) return { symbol: null, quote: null, note: "ALPHA_VANTAGE_API_KEY not configured" };

  const symbol = inferSymbol(hints);
  if (!symbol) return { symbol: null, quote: null, note: "no ticker symbol identified" };

  const quote = await fetchGlobalQuote(apiKey, symbol);
  if (!quote) return { symbol, quote: null, note: "Alpha Vantage returned no quote" };
  return { symbol, quote };
}

function inferSymbol(hints: {
  metadata?: Record<string, unknown> | null;
  title?: string;
  question?: string;
}): string | null {
  const md = hints.metadata ?? {};
  const candidates: unknown[] = [
    (md as Record<string, unknown>).symbol,
    (md as Record<string, unknown>).ticker,
    (md as Record<string, unknown>).instrument,
    (md as Record<string, unknown>).asset,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(c.trim())) {
      return c.trim().toUpperCase();
    }
  }
  // Last-resort: look for an all-caps 2-5 letter token in title/question.
  const text = `${hints.title ?? ""} ${hints.question ?? ""}`;
  const match = text.match(/\b([A-Z]{2,5})\b/);
  if (match) {
    const tok = match[1];
    if (!STOPWORD_TICKERS.has(tok)) return tok;
  }
  return null;
}

const STOPWORD_TICKERS = new Set([
  "US", "USA", "UK", "EU", "ECB", "BOE", "BOJ", "RBA", "RBNZ",
  "FOMC", "GDP", "CPI", "PPI", "NFP", "PMI", "ISM",
  "IPO", "API", "CEO", "CFO", "ETF", "WTI", "OPEC",
]);

async function fetchGlobalQuote(apiKey: string, symbol: string): Promise<AlphaVantageQuote | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AV_TIMEOUT_MS);
  try {
    const url = new URL(AV_BASE);
    url.searchParams.set("function", "GLOBAL_QUOTE");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("apikey", apiKey);
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json() as { "Global Quote"?: Record<string, string> };
    const q = data["Global Quote"];
    if (!q || Object.keys(q).length === 0) return null;
    return {
      symbol: q["01. symbol"] ?? symbol,
      price: toNum(q["05. price"]),
      change: toNum(q["09. change"]),
      change_percent: q["10. change percent"] ?? null,
      volume: toNum(q["06. volume"]),
      latest_trading_day: q["07. latest trading day"] ?? null,
      previous_close: toNum(q["08. previous close"]),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function toNum(v: string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
