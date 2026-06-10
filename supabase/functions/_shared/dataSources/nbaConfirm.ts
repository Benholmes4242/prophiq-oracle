// NBA game-winner confirm via TheSportsDB (free public key "3").
//
// Team list is hardcoded (30 teams, stable reference data). The free-tier
// search_all_teams.php?l=NBA is capped at 10 alphabetical results so it
// cannot resolve Knicks/Lakers/Spurs etc. — hardcoding is more reliable
// than the API for this stable roster. The SCHEDULE still comes live from
// eventsnextleague.php?id=4387.
//
// Match-winner ONLY. Title/playoff outrights stay research_grounded.
// Never throws.

const TSDB_BASE_TEMPLATE = "https://www.thesportsdb.com/api/v1/json";
const TSDB_TIMEOUT_MS = 10_000;
const PUBLIC_KEY = "3";
const NBA_LEAGUE_ID = "4387";

export interface NbaTeam {
  name: string;       // canonical strTeam form returned by TheSportsDB
  tokens: string[];   // lowercase nickname / city / short-code tokens
}

/** Static NBA roster. Tokens are matched against a normalised ref by
 *  whole-word containment. "LA" / "Los Angeles" deliberately omitted —
 *  ambiguous between Lakers + Clippers (require nickname). */
const NBA_TEAMS: NbaTeam[] = [
  { name: "Atlanta Hawks", tokens: ["hawks", "atlanta", "atl"] },
  { name: "Boston Celtics", tokens: ["celtics", "boston", "bos"] },
  { name: "Brooklyn Nets", tokens: ["nets", "brooklyn", "bkn"] },
  { name: "Charlotte Hornets", tokens: ["hornets", "charlotte", "cha"] },
  { name: "Chicago Bulls", tokens: ["bulls", "chicago", "chi"] },
  { name: "Cleveland Cavaliers", tokens: ["cavaliers", "cavs", "cleveland", "cle"] },
  { name: "Dallas Mavericks", tokens: ["mavericks", "mavs", "dallas", "dal"] },
  { name: "Denver Nuggets", tokens: ["nuggets", "denver", "den"] },
  { name: "Detroit Pistons", tokens: ["pistons", "detroit", "det"] },
  { name: "Golden State Warriors", tokens: ["warriors", "golden state", "gsw", "dubs"] },
  { name: "Houston Rockets", tokens: ["rockets", "houston", "hou"] },
  { name: "Indiana Pacers", tokens: ["pacers", "indiana", "ind"] },
  { name: "LA Clippers", tokens: ["clippers", "la clippers", "lac"] },
  { name: "Los Angeles Lakers", tokens: ["lakers", "la lakers", "lal"] },
  { name: "Memphis Grizzlies", tokens: ["grizzlies", "memphis", "mem"] },
  { name: "Miami Heat", tokens: ["heat", "miami", "mia"] },
  { name: "Milwaukee Bucks", tokens: ["bucks", "milwaukee", "mil"] },
  { name: "Minnesota Timberwolves", tokens: ["timberwolves", "wolves", "minnesota", "min"] },
  { name: "New Orleans Pelicans", tokens: ["pelicans", "new orleans", "nop"] },
  { name: "New York Knicks", tokens: ["knicks", "new york knicks", "new york", "nyk"] },
  { name: "Oklahoma City Thunder", tokens: ["thunder", "oklahoma city", "oklahoma", "okc"] },
  { name: "Orlando Magic", tokens: ["magic", "orlando", "orl"] },
  { name: "Philadelphia 76ers", tokens: ["76ers", "sixers", "philadelphia", "phi", "philly"] },
  { name: "Phoenix Suns", tokens: ["suns", "phoenix", "phx"] },
  { name: "Portland Trail Blazers", tokens: ["trail blazers", "blazers", "portland", "por"] },
  { name: "Sacramento Kings", tokens: ["kings", "sacramento", "sac"] },
  { name: "San Antonio Spurs", tokens: ["spurs", "san antonio", "sas"] },
  { name: "Toronto Raptors", tokens: ["raptors", "toronto", "tor"] },
  { name: "Utah Jazz", tokens: ["jazz", "utah", "uta"] },
  { name: "Washington Wizards", tokens: ["wizards", "washington", "was", "wsh"] },
];

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

export async function confirmNbaGame(
  canonicalEvent: string,
  _approxDateISO: string | null,
): Promise<NbaGameConfirm> {
  const refs = extractTeams(canonicalEvent);
  if (!refs) return { kind: "none", reason: "could not parse two NBA teams" };

  const teamA = resolveTeam(refs.a);
  const teamB = resolveTeam(refs.b);
  if (!teamA || !teamB) {
    return { kind: "none", reason: "could not resolve both team references" };
  }
  if (teamA.name === teamB.name) {
    return { kind: "none", reason: "both references resolved to the same team" };
  }

  const base = `${TSDB_BASE_TEMPLATE}/${readEnv("THESPORTSDB_API_KEY") || PUBLIC_KEY}`;
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
// Parsing + resolution
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

/** Resolve a free-text team reference (e.g. "Knicks", "LA Lakers", "NYK")
 *  against NBA_TEAMS. Returns null when no unique match (e.g. bare "LA"). */
export function resolveTeam(ref: string): NbaTeam | null {
  const n = normalise(ref);
  if (!n) return null;
  const hits: NbaTeam[] = [];
  for (const t of NBA_TEAMS) {
    if (normalise(t.name) === n) return t; // exact full-name short-circuit
    for (const tok of t.tokens) {
      if (wordIncludes(n, tok)) {
        hits.push(t);
        break;
      }
    }
  }
  if (hits.length === 1) return hits[0];
  return null; // ambiguous (e.g. bare "LA") or no match
}

/** True when `teamName` (from the schedule feed) refers to the resolved
 *  team. Compares the feed name's normalised form to the canonical and
 *  the token list. */
export function teamNameMatch(team: NbaTeam, teamName: string): boolean {
  const n = normalise(teamName);
  if (!n) return false;
  if (n === normalise(team.name)) return true;
  for (const tok of team.tokens) {
    if (wordIncludes(n, tok)) return true;
  }
  return false;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function wordIncludes(hay: string, needle: string): boolean {
  if (!needle) return false;
  const n = needle.toLowerCase();
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(hay);
}

// ---------------------------------------------------------------------------
// Network
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
  return `${d}T23:00:00Z`;
}

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}
