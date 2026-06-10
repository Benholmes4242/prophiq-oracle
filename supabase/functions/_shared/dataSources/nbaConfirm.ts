// NBA game-winner confirm via TheSportsDB (free public key "3").
//
// Pattern mirrors tennisConfirm.ts (two-competitor). NBA league id 4387.
// Match shape: home vs away. Returns one of single / multiple / none.
//
// Steps:
//  1. extractTeams(canonical) — split on vs / v / at / @ into two team refs.
//  2. Resolve each ref against a cached NBA team list (search_all_teams.php
//     ?l=NBA), matching nickname (last token of strTeam), city, or short
//     code (strTeamShort).
//  3. Pull the upcoming schedule (eventsnextleague.php?id=4387) and match
//     any event whose (home, away) covers both resolved teams in either
//     orientation.
//  4. Return { kind:"single", game } / "multiple" / "none".
//
// Match-winner ONLY. Title/playoff outrights are a separate shape and stay
// research_grounded for now. Never throws.

const TSDB_BASE_TEMPLATE = "https://www.thesportsdb.com/api/v1/json";
const TSDB_TIMEOUT_MS = 10_000;
const PUBLIC_KEY = "3";
const NBA_LEAGUE_ID = "4387";

// Module-scope cache for the NBA team list (30 teams; small + stable).
let TEAM_CACHE: NbaTeam[] | null = null;
let TEAM_CACHE_AT = 0;
const TEAM_CACHE_TTL_MS = 60 * 60 * 1000; // 1h

export interface NbaTeam {
  id: string;
  name: string;        // strTeam, e.g. "Los Angeles Lakers"
  short: string | null;// strTeamShort, e.g. "LAL"
  nickname: string;    // last token(s) of strTeam, e.g. "Lakers"
  city: string;        // strTeam minus nickname, e.g. "Los Angeles"
}

export interface NbaGameCandidate {
  event_id: string;
  home: string;
  away: string;
  date: string;       // YYYY-MM-DD
  starts_at: string;  // ISO
  event_name: string;
}

export type NbaGameConfirm =
  | { kind: "single"; game: NbaGameCandidate }
  | { kind: "multiple"; games: NbaGameCandidate[] }
  | { kind: "none"; reason: string };

interface TSDBRawEvent {
  idEvent?: string | null;
  strEvent?: string | null;
  strSport?: string | null;
  strLeague?: string | null;
  dateEvent?: string | null;
  strTime?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
}

interface TSDBRawTeam {
  idTeam?: string | null;
  strTeam?: string | null;
  strTeamShort?: string | null;
  strSport?: string | null;
  strLeague?: string | null;
}

export async function confirmNbaGame(
  canonicalEvent: string,
  _approxDateISO: string | null,
): Promise<NbaGameConfirm> {
  const refs = extractTeams(canonicalEvent);
  if (!refs) return { kind: "none", reason: "could not parse two NBA teams" };

  const base = `${TSDB_BASE_TEMPLATE}/${readEnv("THESPORTSDB_API_KEY") || PUBLIC_KEY}`;
  const teams = await loadNbaTeams(base);
  if (!teams || teams.length === 0) {
    return { kind: "none", reason: "could not load NBA team list" };
  }

  const teamA = resolveTeam(refs.a, teams);
  const teamB = resolveTeam(refs.b, teams);
  if (!teamA || !teamB) {
    return { kind: "none", reason: "could not resolve both team references" };
  }
  if (teamA.id === teamB.id) {
    return { kind: "none", reason: "both references resolved to the same team" };
  }

  const events = await fetchNextLeagueEvents(base);
  if (!events) return { kind: "none", reason: "could not fetch NBA schedule" };

  const candidates: NbaGameCandidate[] = [];
  for (const ev of events) {
    const home = String(ev.strHomeTeam ?? "").trim();
    const away = String(ev.strAwayTeam ?? "").trim();
    if (!home || !away) continue;
    const matches =
      (teamNameMatch(teamA, home) && teamNameMatch(teamB, away)) ||
      (teamNameMatch(teamA, away) && teamNameMatch(teamB, home));
    if (!matches) continue;
    const date = ev.dateEvent ?? "";
    candidates.push({
      event_id: String(ev.idEvent ?? ""),
      home,
      away,
      date,
      starts_at: combineDateTime(date, ev.strTime ?? null),
      event_name: String(ev.strEvent ?? `${away} @ ${home}`).trim(),
    });
  }

  if (candidates.length === 0) {
    return { kind: "none", reason: "no upcoming NBA game found for both teams" };
  }
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.event_id)) return false;
    seen.add(c.event_id);
    return true;
  });
  if (unique.length === 1) return { kind: "single", game: unique[0] };
  return { kind: "multiple", games: unique.slice(0, 6) };
}

// ---------------------------------------------------------------------------
// Team resolution
// ---------------------------------------------------------------------------

/** Parse the canonical event into two team references. Splits on vs / v /
 *  at / @. Returns null when fewer than two halves. */
export function extractTeams(canonical: string): { a: string; b: string } | null {
  if (!canonical) return null;
  const m = canonical.match(/^(.+?)\s+(?:vs\.?|versus|v|at|@)\s+(.+?)(?:\s*[\(\-,]|$)/i);
  if (!m) return null;
  const a = m[1].trim();
  const b = m[2].trim();
  if (!a || !b) return null;
  return { a, b };
}

async function loadNbaTeams(base: string): Promise<NbaTeam[] | null> {
  const now = Date.now();
  if (TEAM_CACHE && now - TEAM_CACHE_AT < TEAM_CACHE_TTL_MS) return TEAM_CACHE;
  const url = `${base}/search_all_teams.php?l=NBA`;
  const raw = await fetchJson<{ teams?: TSDBRawTeam[] | null }>(url);
  if (!raw || !Array.isArray(raw.teams)) return null;
  const list: NbaTeam[] = [];
  for (const t of raw.teams) {
    const name = String(t.strTeam ?? "").trim();
    if (!name) continue;
    // Defence in depth: filter to basketball / NBA only.
    const sport = String(t.strSport ?? "").toLowerCase();
    const league = String(t.strLeague ?? "").toLowerCase();
    if (sport && sport !== "basketball") continue;
    if (league && !league.includes("nba")) continue;
    const tokens = name.split(/\s+/);
    // Handle "Portland Trail Blazers" (nickname = last two tokens) by
    // taking the last 1-2 tokens but always keeping the FULL name match.
    const nickname = tokens[tokens.length - 1] ?? name;
    const city = tokens.slice(0, -1).join(" ") || name;
    list.push({
      id: String(t.idTeam ?? ""),
      name,
      short: t.strTeamShort ? String(t.strTeamShort).trim() : null,
      nickname,
      city,
    });
  }
  if (list.length === 0) return null;
  TEAM_CACHE = list;
  TEAM_CACHE_AT = now;
  return list;
}

/** Resolve a free-text team reference (e.g. "Knicks", "LA Lakers", "LAL")
 *  to a canonical team. Score: full-name contains > nickname == > city == >
 *  short-code ==. Null when no match. */
function resolveTeam(ref: string, teams: NbaTeam[]): NbaTeam | null {
  const n = normalise(ref);
  if (!n) return null;
  let best: { team: NbaTeam; score: number } | null = null;
  for (const t of teams) {
    const fullN = normalise(t.name);
    const nickN = normalise(t.nickname);
    const cityN = normalise(t.city);
    const shortN = t.short ? normalise(t.short) : "";
    let score = 0;
    if (fullN === n) score = 100;
    else if (nickN && nickN === n) score = 90;
    else if (shortN && shortN === n) score = 85;
    // "LA Lakers" / "Brooklyn Nets" — both tokens hit.
    else if (nickN && cityN && (n.includes(nickN) && n.includes(cityN))) score = 80;
    // Bare nickname inside the ref ("New York Knicks tonight").
    else if (nickN && wordIncludes(n, nickN)) score = 70;
    // Full team name appears as substring of ref.
    else if (fullN && n.includes(fullN)) score = 65;
    // City-only — last resort (Miami, LA, NY), but ambiguous and risky.
    // Skip unless ref is exactly the city AND the city is unique enough
    // (don't auto-match "Miami" since Heat shares with other Miami brands).
    else if (cityN && cityN === n && cityN.length >= 5) score = 30;
    if (score > 0 && (!best || score > best.score)) best = { team: t, score };
  }
  return best && best.score >= 50 ? best.team : null;
}

/** True when `teamName` (from the feed) refers to the resolved team. */
export function teamNameMatch(team: NbaTeam, teamName: string): boolean {
  const n = normalise(teamName);
  if (!n) return false;
  if (n === normalise(team.name)) return true;
  if (team.short && n === normalise(team.short)) return true;
  if (wordIncludes(n, normalise(team.nickname))) return true;
  return false;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function wordIncludes(hay: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(hay);
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

async function fetchNextLeagueEvents(base: string): Promise<TSDBRawEvent[] | null> {
  const url = `${base}/eventsnextleague.php?id=${NBA_LEAGUE_ID}`;
  const raw = await fetchJson<{ events?: TSDBRawEvent[] | null }>(url);
  if (!raw) return null;
  return raw.events ?? [];
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TSDB_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function combineDateTime(date: string, time: string | null): string {
  const d = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : new Date().toISOString().slice(0, 10);
  if (time && /^\d{2}:\d{2}/.test(time)) {
    return `${d}T${time.slice(0, 8).padEnd(8, "0")}Z`.replace(/T(\d{2}:\d{2})Z$/, "T$1:00Z");
  }
  return `${d}T23:00:00Z`; // NBA tip-offs are evening local; placeholder when missing
}

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}
