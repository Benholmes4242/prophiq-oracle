// TMDb (The Movie Database) adapter. v3 API key via query parameter.
// Docs: https://developer.themoviedb.org/reference/intro/getting-started
//
// Brief GG: best-effort context for film releases, awards, franchises.
// Strategy:
//   1. /search/multi?query=<title-tokens> — fuzzy match movies & TV
//   2. Pick top hit, fetch /movie/{id} or /tv/{id} for richer detail
// Falls back gracefully when no API key or no match.

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_TIMEOUT_MS = 10_000;

export interface TmdbHit {
  id: number;
  media_type: "movie" | "tv" | "person";
  title: string;
  release_date: string | null;
  overview: string | null;
  vote_average: number | null;
  vote_count: number | null;
  popularity: number | null;
}

export interface TmdbDetail {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  release_date: string | null;
  runtime: number | null;
  status: string | null;
  vote_average: number | null;
  vote_count: number | null;
  popularity: number | null;
  budget: number | null;
  revenue: number | null;
  genres: string[];
  production_companies: string[];
  tagline: string | null;
  overview: string | null;
}

export interface TmdbSnapshot {
  query: string;
  top_hits: TmdbHit[];
  matched: TmdbDetail | null;
  note?: string;
}

interface TmdbHints {
  metadata?: Record<string, unknown> | null;
  title?: string;
  question?: string;
  starts_at?: string;
}

export async function fetchTmdbContext(
  apiKey: string,
  hints: TmdbHints,
): Promise<TmdbSnapshot> {
  if (!apiKey) {
    return { query: "", top_hits: [], matched: null, note: "TMDB_API_KEY missing" };
  }

  const query = buildSearchQuery(hints);
  if (!query) {
    return { query: "", top_hits: [], matched: null, note: "no usable query from event" };
  }

  const hits = await searchMulti(apiKey, query);
  if (!hits || hits.length === 0) {
    return { query, top_hits: [], matched: null, note: "no TMDb matches" };
  }

  const filmlike = hits.filter((h) => h.media_type === "movie" || h.media_type === "tv");
  const top = filmlike[0] ?? null;
  let matched: TmdbDetail | null = null;
  if (top) {
    matched = await fetchDetail(apiKey, top);
  }

  return { query, top_hits: filmlike.slice(0, 5), matched };
}

function buildSearchQuery(hints: TmdbHints): string {
  const title = hints.title ?? "";
  // Drop trailing parenthetical and qualifier dashes.
  const cleaned = title.split(/[\(\-:]/)[0].trim();
  // Strip leading award qualifiers like "Best Picture:" residue.
  return cleaned.replace(/\s+/g, " ").trim();
}

async function searchMulti(apiKey: string, query: string): Promise<TmdbHit[] | null> {
  const url = `${TMDB_BASE}/search/multi?query=${encodeURIComponent(query)}&include_adult=false&page=1`;
  const data = await tmdbFetch<{ results?: Array<Record<string, unknown>> }>(apiKey, url);
  if (!data || !Array.isArray(data.results)) return null;
  return data.results.map(normaliseHit).filter((h): h is TmdbHit => h !== null);
}

async function fetchDetail(apiKey: string, hit: TmdbHit): Promise<TmdbDetail | null> {
  const path = hit.media_type === "movie" ? `/movie/${hit.id}` : `/tv/${hit.id}`;
  const data = await tmdbFetch<Record<string, unknown>>(apiKey, `${TMDB_BASE}${path}`);
  if (!data) return null;
  return normaliseDetail(data, hit.media_type);
}

async function tmdbFetch<T>(apiKey: string, url: string): Promise<T | null> {
  const sep = url.includes("?") ? "&" : "?";
  const finalUrl = `${url}${sep}api_key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS);
  try {
    const res = await fetch(finalUrl, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normaliseHit(r: Record<string, unknown>): TmdbHit | null {
  const id = typeof r.id === "number" ? r.id : null;
  const media_type = r.media_type as string | undefined;
  if (id === null || (media_type !== "movie" && media_type !== "tv" && media_type !== "person")) return null;
  const title = (r.title as string | undefined) ?? (r.name as string | undefined) ?? "";
  const release_date = (r.release_date as string | undefined) ?? (r.first_air_date as string | undefined) ?? null;
  return {
    id,
    media_type,
    title,
    release_date,
    overview: (r.overview as string | undefined) ?? null,
    vote_average: typeof r.vote_average === "number" ? r.vote_average : null,
    vote_count: typeof r.vote_count === "number" ? r.vote_count : null,
    popularity: typeof r.popularity === "number" ? r.popularity : null,
  };
}

function normaliseDetail(r: Record<string, unknown>, media_type: "movie" | "tv"): TmdbDetail {
  const genres = Array.isArray(r.genres)
    ? (r.genres as Array<{ name?: string }>).map((g) => g.name ?? "").filter(Boolean)
    : [];
  const production_companies = Array.isArray(r.production_companies)
    ? (r.production_companies as Array<{ name?: string }>).map((c) => c.name ?? "").filter(Boolean)
    : [];
  const id = typeof r.id === "number" ? r.id : 0;
  const title = (r.title as string | undefined) ?? (r.name as string | undefined) ?? "";
  const release_date = (r.release_date as string | undefined) ?? (r.first_air_date as string | undefined) ?? null;
  const runtime = typeof r.runtime === "number"
    ? r.runtime
    : (Array.isArray(r.episode_run_time) && typeof (r.episode_run_time as number[])[0] === "number"
      ? (r.episode_run_time as number[])[0]
      : null);
  return {
    id,
    media_type,
    title,
    release_date,
    runtime,
    status: (r.status as string | undefined) ?? null,
    vote_average: typeof r.vote_average === "number" ? r.vote_average : null,
    vote_count: typeof r.vote_count === "number" ? r.vote_count : null,
    popularity: typeof r.popularity === "number" ? r.popularity : null,
    budget: typeof r.budget === "number" ? r.budget : null,
    revenue: typeof r.revenue === "number" ? r.revenue : null,
    genres,
    production_companies,
    tagline: (r.tagline as string | undefined) ?? null,
    overview: (r.overview as string | undefined) ?? null,
  };
}
