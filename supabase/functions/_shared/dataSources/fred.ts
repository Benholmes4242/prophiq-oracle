// FRED (Federal Reserve Economic Data) adapter. Read-only public API.
// Docs: https://fred.stlouisfed.org/docs/api/fred/
//
// Brief GG: returns the latest observation for a curated set of macro
// series that are broadly useful as ground-truth context for any markets
// event (Fed decisions, CPI prints, NFP, GDP, LEI, unemployment, etc.).

const FRED_BASE = "https://api.stlouisfed.org/fred";
const FRED_TIMEOUT_MS = 10_000;

// Curated macro series. Keep small to stay under the 25/day free quota
// when called per-event; each call below issues one HTTP request per series.
const DEFAULT_SERIES: Array<{ id: string; label: string; units?: string }> = [
  { id: "USSLIND", label: "Leading Economic Index (state-level, US)" },
  { id: "CPIAUCSL", label: "CPI for All Urban Consumers (SA)", units: "index" },
  { id: "PAYEMS", label: "Total Nonfarm Payrolls", units: "thousands of persons" },
  { id: "UNRATE", label: "Unemployment Rate", units: "%" },
  { id: "FEDFUNDS", label: "Effective Federal Funds Rate", units: "%" },
  { id: "GDP", label: "Gross Domestic Product", units: "$B SAAR" },
];

export interface FredObservation {
  series_id: string;
  label: string;
  units?: string;
  date: string;       // YYYY-MM-DD
  value: number | null;
}

export interface FredSnapshot {
  observations: FredObservation[];
  note?: string;
}

export async function fetchFredMacroSnapshot(
  apiKey: string,
  series: typeof DEFAULT_SERIES = DEFAULT_SERIES,
): Promise<FredSnapshot> {
  if (!apiKey) return { observations: [], note: "FRED_API_KEY not configured" };

  const results = await Promise.allSettled(
    series.map((s) => fetchLatestObservation(apiKey, s.id, s.label, s.units)),
  );

  const observations: FredObservation[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) observations.push(r.value);
  }
  if (observations.length === 0) {
    return { observations: [], note: "no FRED observations returned" };
  }
  return { observations };
}

async function fetchLatestObservation(
  apiKey: string,
  seriesId: string,
  label: string,
  units?: string,
): Promise<FredObservation | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FRED_TIMEOUT_MS);
  try {
    const url = new URL(`${FRED_BASE}/series/observations`);
    url.searchParams.set("series_id", seriesId);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("file_type", "json");
    url.searchParams.set("sort_order", "desc");
    url.searchParams.set("limit", "1");
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      observations?: Array<{ date?: string; value?: string }>;
    };
    const o = data.observations?.[0];
    if (!o || !o.date) return null;
    const rawValue = o.value;
    const value = rawValue && rawValue !== "." ? Number(rawValue) : null;
    return {
      series_id: seriesId,
      label,
      units,
      date: o.date,
      value: Number.isFinite(value as number) ? (value as number) : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
