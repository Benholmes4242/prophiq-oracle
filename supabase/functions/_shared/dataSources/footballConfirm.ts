// Football confirm helpers (Step 4: feed-backed parity for the two popular
// winner questions - match winner (1X2) and league/title winner).
//
// Mirrors the racing/golf confirm pattern: the resolver names the event,
// these helpers verify it against the live feed and return a structured
// payload the caller threads into event.metadata + outcomes. NEVER throws;
// on any failure returns { kind: "none" } and the caller falls through to
// research_grounded.
//
// Sources:
//   - football-data.org /matches (dateFrom/dateTo) for fixture confirm
//   - api-sports /standings for league title field
//
// No new external feeds; both adapters already exist.

import { getLeagueStandings, type ApiSportsStanding } from "./apiSports.ts";

const FD_BASE = "https://api.football-data.org/v4";
const FD_TIMEOUT_MS = 10_000;

export interface FootballMatchCandidate {
  fixture_id: string;
  competition: string;
  home_team: string;
  away_team: string;
  kickoff: string; // ISO
}

export type FootballMatchConfirm =
  | { kind: "single"; match: FootballMatchCandidate }
  | { kind: "multiple"; matches: FootballMatchCandidate[] }
  | { kind: "none"; reason: string };

export interface FootballLeagueConfirm {
  kind: "league" | "none";
  competition?: string;
  league_id?: number;
  season?: number;
  standings?: ApiSportsStanding[];
  contenders?: string[]; // ordered, real team names (top N by points)
  resolves_at?: string; // ISO, end-of-season approx
  reason?: string;
}

/**
 * Confirm a football match from the resolver's canonical_event. Parses the
 * two team names from "Arsenal vs Chelsea" / "Arsenal v Chelsea" / etc and
 * looks up fixtures in football-data.org within a +/- 7 day window around
 * approx_date (or today). Returns:
 *   - single   : one clean future fixture -> feed_backed match
 *   - multiple : two+ candidates (e.g. league + cup meeting) -> picker
 *   - none     : no fixture found -> caller falls through to research_grounded
 */
export async function confirmFootballMatch(
  canonicalEvent: string,
  approxDateISO: string | null,
  competitors: string[] | null,
): Promise<FootballMatchConfirm> {
  const apiKey = readEnv("FOOTBALL_DATA_API_KEY");
  if (!apiKey) return { kind: "none", reason: "FOOTBALL_DATA_API_KEY missing" };

  const teams = extractTeams(canonicalEvent, competitors);
  if (!teams) return { kind: "none", reason: "could not parse two teams" };

  const center = approxDateISO ? new Date(approxDateISO) : new Date();
  if (Number.isNaN(center.getTime())) {
    return { kind: "none", reason: "bad approx_date" };
  }
  const dateFrom = isoDate(new Date(center.getTime() - 7 * 86400000));
  const dateTo = isoDate(new Date(center.getTime() + 14 * 86400000));

  const matches = await fetchMatches(apiKey, dateFrom, dateTo);
  if (matches === null) return { kind: "none", reason: "feed request failed" };
  if (matches.length === 0) return { kind: "none", reason: "no fixtures in window" };

  const aTok = tokenize(teams.a);
  const bTok = tokenize(teams.b);
  const candidates: FootballMatchCandidate[] = [];
  for (const m of matches) {
    const home = tokenize(m.home_team);
    const away = tokenize(m.away_team);
    const ah = overlap(aTok, home);
    const ba = overlap(bTok, away);
    const aa = overlap(aTok, away);
    const bh = overlap(bTok, home);
    if ((ah && ba) || (aa && bh)) {
      candidates.push({
        fixture_id: String(m.id),
        competition: m.competition,
        home_team: m.home_team,
        away_team: m.away_team,
        kickoff: m.utc_date,
      });
    }
  }
  if (candidates.length === 0) return { kind: "none", reason: "no team-name match" };
  if (candidates.length === 1) return { kind: "single", match: candidates[0] };
  // Prefer non-completed; if multiple future fixtures remain, picker.
  const future = candidates.filter((c) => new Date(c.kickoff).getTime() >= Date.now() - 2 * 86400000);
  if (future.length === 1) return { kind: "single", match: future[0] };
  if (future.length === 0) return { kind: "single", match: candidates[0] };
  return { kind: "multiple", matches: future.slice(0, 6) };
}

/**
 * Confirm a league/title-winner question. Maps the canonical_event string to
 * an api-sports league id, fetches live standings, returns the ordered
 * contenders. End-of-season is approximated to late May of the season's end
 * year (good enough for resolves_at; cron resolution does the real check).
 */
export async function confirmFootballLeague(
  canonicalEvent: string,
): Promise<FootballLeagueConfirm> {
  const m = matchLeague(canonicalEvent);
  if (!m) return { kind: "none", reason: "no known league in canonical_event" };
  const season = pickSeason(canonicalEvent);
  let standings: ApiSportsStanding[] = [];
  try {
    standings = await getLeagueStandings(m.id, season);
  } catch {
    return { kind: "none", reason: "standings fetch threw" };
  }
  if (standings.length === 0) {
    return { kind: "none", reason: "empty standings" };
  }
  const ordered = [...standings].sort((a, b) => a.rank - b.rank);
  const contenders = ordered.map((s) => s.team_name);
  const endYear = season + 1;
  const resolvesAt = new Date(Date.UTC(endYear, 4, 25, 18, 0, 0)).toISOString(); // late May
  return {
    kind: "league",
    competition: m.name,
    league_id: m.id,
    season,
    standings: ordered,
    contenders,
    resolves_at: resolvesAt,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface FdMatch {
  id: number;
  utc_date: string;
  status: string;
  competition: string;
  home_team: string;
  away_team: string;
}

async function fetchMatches(
  apiKey: string,
  dateFrom: string,
  dateTo: string,
): Promise<FdMatch[] | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FD_TIMEOUT_MS);
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
      }>;
    };
    return (data.matches ?? []).map((m) => ({
      id: m.id,
      utc_date: m.utcDate,
      status: m.status,
      competition: m.competition?.name ?? "",
      home_team: m.homeTeam?.name ?? "",
      away_team: m.awayTeam?.name ?? "",
    }));
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractTeams(
  canonical: string,
  competitors: string[] | null,
): { a: string; b: string } | null {
  if (competitors && competitors.length === 2) {
    const [a, b] = competitors;
    if (a && b) return { a: a.trim(), b: b.trim() };
  }
  const m = canonical.match(/(.+?)\s+(?:v|vs|vs\.|versus)\s+(.+?)(?:\s*[\(\-\?,]|$)/i);
  if (m) return { a: m[1].trim(), b: m[2].trim() };
  return null;
}

const LEAGUE_MAP: Array<{ patterns: RegExp[]; id: number; name: string }> = [
  { patterns: [/\bpremier league\b/i, /\bepl\b/i, /\benglish premier\b/i], id: 39, name: "Premier League" },
  { patterns: [/\bla\s*liga\b/i, /\bspanish la liga\b/i], id: 140, name: "La Liga" },
  { patterns: [/\bserie a\b/i, /\bitalian serie a\b/i], id: 135, name: "Serie A" },
  { patterns: [/\bbundesliga\b/i], id: 78, name: "Bundesliga" },
  { patterns: [/\bligue 1\b/i, /\bfrench ligue 1\b/i], id: 61, name: "Ligue 1" },
  { patterns: [/\bchampions league\b/i, /\bucl\b/i], id: 2, name: "UEFA Champions League" },
  { patterns: [/\beuropa league\b/i], id: 3, name: "UEFA Europa League" },
  { patterns: [/\b(efl |english )?championship\b/i], id: 40, name: "Championship" },
  { patterns: [/\beredivisie\b/i], id: 88, name: "Eredivisie" },
  { patterns: [/\bprimeira liga\b/i, /\bportuguese liga\b/i], id: 94, name: "Primeira Liga" },
  { patterns: [/\bmls\b/i, /\bmajor league soccer\b/i], id: 253, name: "MLS" },
  { patterns: [/\bsaudi pro league\b/i], id: 307, name: "Saudi Pro League" },
];

function matchLeague(canonical: string): { id: number; name: string } | null {
  for (const entry of LEAGUE_MAP) {
    for (const p of entry.patterns) {
      if (p.test(canonical)) return { id: entry.id, name: entry.name };
    }
  }
  return null;
}

function pickSeason(canonical: string): number {
  // Look for explicit 4-digit start year ("2025-26", "2025/26", "2026").
  const m = canonical.match(/\b(20\d{2})\b/);
  if (m) return Number(m[1]);
  const now = new Date();
  // European seasons run Aug -> May. From July onward, current calendar year
  // is the start year; before July, the start year is last year.
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/**
 * Cheap canonical-event shape test used by the resolver branch in submit-
 * question to decide whether to take the match-confirm path or the league-
 * confirm path. Never throws; returns "neither" when nothing fits and the
 * caller leaves football on the research_grounded path.
 */
export function classifyFootballEvent(
  canonical: string,
  competitors: string[] | null,
): "match" | "league" | "neither" {
  const c = canonical || "";
  if (/\s(v|vs|vs\.|versus)\s/i.test(c)) return "match";
  if (competitors && competitors.length === 2) return "match";
  if (matchLeague(c)) return "league";
  return "neither";
}

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP.has(t)),
  );
}
function overlap(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t)) return true;
  return false;
}
const STOP = new Set(["the", "and", "fc", "cf", "afc", "club", "united", "city"]);

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}
