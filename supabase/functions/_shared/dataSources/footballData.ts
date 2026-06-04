// football-data.org adapter. Free tier: 10 req/min, limited competitions
// (EPL, La Liga, Serie A, Bundesliga, Ligue 1, Champions League, World Cup,
// Euros, Copa America, etc.). Auth via X-Auth-Token header.
// Docs: https://www.football-data.org/documentation/quickstart
//
// Brief GG: best-effort context for sport events. We pull upcoming matches
// in a +/- 2 day window and try to match by team names extracted from the
// event title/question. Falls back gracefully when no match is found.

const FD_BASE = "https://api.football-data.org/v4";
const FD_TIMEOUT_MS = 10_000;

export interface FootballDataMatch {
  id: number;
  utc_date: string;
  status: string;
  competition: string;
  home_team: string;
  away_team: string;
  score: {
    full_time: { home: number | null; away: number | null };
    half_time: { home: number | null; away: number | null };
  };
}

export interface FootballDataSnapshot {
  matched: FootballDataMatch | null;
  candidates: FootballDataMatch[];
  note?: string;
}

interface FootballDataHints {
  metadata?: Record<string, unknown> | null;
  title?: string;
  question?: string;
  starts_at?: string;
}

export async function fetchFootballDataContext(
  apiKey: string,
  hints: FootballDataHints,
): Promise<FootballDataSnapshot> {
  if (!apiKey) {
    return { matched: null, candidates: [], note: "FOOTBALL_DATA_API_KEY not configured" };
  }
  if (!isFootballEvent(hints)) {
    return { matched: null, candidates: [], note: "not a football event" };
  }
  const teams = extractTeamNames(hints);
  if (!teams) {
    return { matched: null, candidates: [], note: "could not extract team names" };
  }

  const center = hints.starts_at ? new Date(hints.starts_at) : new Date();
  const dateFrom = isoDate(new Date(center.getTime() - 2 * 24 * 60 * 60 * 1000));
  const dateTo = isoDate(new Date(center.getTime() + 2 * 24 * 60 * 60 * 1000));

  const matches = await fetchMatches(apiKey, dateFrom, dateTo);
  if (matches === null) {
    return { matched: null, candidates: [], note: "football-data.org request failed" };
  }
  if (matches.length === 0) {
    return { matched: null, candidates: [], note: "no matches in window" };
  }

  const matched = findMatch(matches, teams);
  return {
    matched,
    candidates: matched ? [] : matches.slice(0, 5),
    note: matched ? undefined : "no exact team-name match within window",
  };
}

function isFootballEvent(hints: FootballDataHints): boolean {
  const md = hints.metadata ?? {};
  const text = [
    hints.title ?? "",
    hints.question ?? "",
    String((md as Record<string, unknown>).sub_category ?? ""),
    String((md as Record<string, unknown>).sport ?? ""),
    String((md as Record<string, unknown>).league ?? ""),
  ].join(" ").toLowerCase();

  const negative = [
    "nfl", "american football", "super bowl", "nba", "basketball",
    "tennis", "golf", "pga", "f1", "formula 1", "grand prix", "motogp",
    "ufc", "mma", "boxing", "cricket", "rugby", "horse rac",
  ];
  for (const k of negative) if (text.includes(k)) return false;

  const positive = [
    "premier league", "la liga", "serie a", "bundesliga", "ligue 1",
    "champions league", "europa league", "fa cup", "carabao cup",
    "world cup", "uefa", "fifa", "concacaf", "afcon", "copa america",
    "mls", "championship", "football", "soccer",
  ];
  for (const k of positive) if (text.includes(k)) return true;
  return false;
}

function extractTeamNames(hints: FootballDataHints): { a: string; b: string } | null {
  const text = `${hints.title ?? ""} ${hints.question ?? ""}`;
  const m = text.match(/(.+?)\s+(?:v|vs|vs\.|versus)\s+(.+?)(?:\s*[\(\-\?,]|$)/i);
  if (!m) return null;
  return { a: m[1].trim(), b: m[2].trim() };
}

async function fetchMatches(
  apiKey: string,
  dateFrom: string,
  dateTo: string,
): Promise<FootballDataMatch[] | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FD_TIMEOUT_MS);
  try {
    const url = new URL(`${FD_BASE}/matches`);
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);
    const res = await fetch(url.toString(), {
      headers: { "X-Auth-Token": apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      matches?: Array<{
        id: number;
        utcDate: string;
        status: string;
        competition?: { name?: string };
        homeTeam?: { name?: string };
        awayTeam?: { name?: string };
        score?: {
          fullTime?: { home: number | null; away: number | null };
          halfTime?: { home: number | null; away: number | null };
        };
      }>;
    };
    return (data.matches ?? []).map((m) => ({
      id: m.id,
      utc_date: m.utcDate,
      status: m.status,
      competition: m.competition?.name ?? "",
      home_team: m.homeTeam?.name ?? "",
      away_team: m.awayTeam?.name ?? "",
      score: {
        full_time: {
          home: m.score?.fullTime?.home ?? null,
          away: m.score?.fullTime?.away ?? null,
        },
        half_time: {
          home: m.score?.halfTime?.home ?? null,
          away: m.score?.halfTime?.away ?? null,
        },
      },
    }));
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function findMatch(
  matches: FootballDataMatch[],
  teams: { a: string; b: string },
): FootballDataMatch | null {
  const aTokens = tokenize(teams.a);
  const bTokens = tokenize(teams.b);
  for (const m of matches) {
    const home = tokenize(m.home_team);
    const away = tokenize(m.away_team);
    const aMatchesHome = overlap(aTokens, home);
    const bMatchesAway = overlap(bTokens, away);
    const aMatchesAway = overlap(aTokens, away);
    const bMatchesHome = overlap(bTokens, home);
    if ((aMatchesHome && bMatchesAway) || (aMatchesAway && bMatchesHome)) return m;
  }
  return null;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

function overlap(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t)) return true;
  return false;
}

const STOPWORDS = new Set(["the", "and", "fc", "cf", "afc", "club", "united", "city"]);

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
