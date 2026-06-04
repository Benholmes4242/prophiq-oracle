// TheSportsDB adapter. Free API key "3" for V1 endpoints. Broad sport
// coverage: NBA, NFL, NHL, MLB, MotoGP, F1, UFC, tennis, golf, etc.
// Docs: https://www.thesportsdb.com/free_sports_api
//
// Brief GG: best-effort context. Strategy is two-pronged:
//   1. searchevents.php?e=<title> — fuzzy match by event name
//   2. eventsday.php?d=YYYY-MM-DD&s=<sport> — fallback by date+sport
// Falls back gracefully when nothing is found.

const TSDB_BASE_TEMPLATE = "https://www.thesportsdb.com/api/v1/json";
const TSDB_TIMEOUT_MS = 10_000;

export interface TheSportsDBEvent {
  id: string;
  name: string;
  sport: string;
  league: string;
  date: string | null;
  time: string | null;
  home_team: string | null;
  away_team: string | null;
  home_score: string | null;
  away_score: string | null;
  status: string | null;
  venue: string | null;
  season: string | null;
}

export interface TheSportsDBSnapshot {
  events: TheSportsDBEvent[];
  matched: TheSportsDBEvent | null;
  note?: string;
}

interface TheSportsDBHints {
  metadata?: Record<string, unknown> | null;
  title?: string;
  question?: string;
  starts_at?: string;
}

export async function fetchTheSportsDBContext(
  apiKey: string,
  hints: TheSportsDBHints,
): Promise<TheSportsDBSnapshot> {
  const key = apiKey || "3"; // public free key
  const base = `${TSDB_BASE_TEMPLATE}/${key}`;

  const queryParts: string[] = [];
  if (hints.title) queryParts.push(hints.title);
  const query = queryParts.join(" ").trim();

  // 1. Try searchevents.php
  let events: TheSportsDBEvent[] = [];
  if (query) {
    const searchTerm = simplifyForSearch(query);
    if (searchTerm) {
      const found = await searchEvents(base, searchTerm);
      if (found) events = found;
    }
  }

  // 2. Fallback by sport + date if nothing found
  if (events.length === 0) {
    const sport = inferSport(hints);
    if (sport && hints.starts_at) {
      const date = hints.starts_at.slice(0, 10);
      const dayEvents = await eventsByDay(base, date, sport);
      if (dayEvents) events = dayEvents;
    }
  }

  if (events.length === 0) {
    return { events: [], matched: null, note: "no events found on TheSportsDB" };
  }

  const matched = matchEvent(events, hints);
  return { events: events.slice(0, 8), matched };
}

async function searchEvents(base: string, term: string): Promise<TheSportsDBEvent[] | null> {
  const url = `${base}/searchevents.php?e=${encodeURIComponent(term)}`;
  return await fetchEvents(url);
}

async function eventsByDay(
  base: string,
  date: string,
  sport: string,
): Promise<TheSportsDBEvent[] | null> {
  const url = `${base}/eventsday.php?d=${date}&s=${encodeURIComponent(sport)}`;
  return await fetchEvents(url);
}

async function fetchEvents(url: string): Promise<TheSportsDBEvent[] | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TSDB_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json() as { event?: Array<Record<string, string | null>> | null };
    if (!data.event || !Array.isArray(data.event)) return [];
    return data.event.map(normaliseEvent);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normaliseEvent(e: Record<string, string | null>): TheSportsDBEvent {
  return {
    id: String(e.idEvent ?? ""),
    name: String(e.strEvent ?? ""),
    sport: String(e.strSport ?? ""),
    league: String(e.strLeague ?? ""),
    date: e.dateEvent ?? null,
    time: e.strTime ?? null,
    home_team: e.strHomeTeam ?? null,
    away_team: e.strAwayTeam ?? null,
    home_score: e.intHomeScore ?? null,
    away_score: e.intAwayScore ?? null,
    status: e.strStatus ?? null,
    venue: e.strVenue ?? null,
    season: e.strSeason ?? null,
  };
}

function matchEvent(events: TheSportsDBEvent[], hints: TheSportsDBHints): TheSportsDBEvent | null {
  const titleTokens = tokenize(hints.title ?? "");
  if (titleTokens.size === 0) return null;

  let best: { ev: TheSportsDBEvent; score: number } | null = null;
  for (const ev of events) {
    const evTokens = tokenize(`${ev.name} ${ev.home_team ?? ""} ${ev.away_team ?? ""} ${ev.league}`);
    let score = 0;
    for (const t of titleTokens) if (evTokens.has(t)) score += 1;
    if (best === null || score > best.score) best = { ev, score };
  }
  return best && best.score >= 2 ? best.ev : null;
}

function inferSport(hints: TheSportsDBHints): string | null {
  const md = hints.metadata ?? {};
  const text = [
    hints.title ?? "",
    hints.question ?? "",
    String((md as Record<string, unknown>).sub_category ?? ""),
    String((md as Record<string, unknown>).sport ?? ""),
    String((md as Record<string, unknown>).league ?? ""),
  ].join(" ").toLowerCase();

  if (/\bf1\b|formula 1|grand prix/.test(text)) return "Motorsport";
  if (/motogp|moto gp/.test(text)) return "Motorsport";
  if (/nba|basketball/.test(text)) return "Basketball";
  if (/nfl|american football|super bowl/.test(text)) return "American Football";
  if (/nhl|ice hockey|hockey/.test(text)) return "Ice Hockey";
  if (/mlb|baseball/.test(text)) return "Baseball";
  if (/ufc|mma/.test(text)) return "Fighting";
  if (/boxing/.test(text)) return "Fighting";
  if (/tennis|wimbledon|us open|french open|australian open/.test(text)) return "Tennis";
  if (/golf|pga|masters|ryder cup/.test(text)) return "Golf";
  if (/cricket|ipl/.test(text)) return "Cricket";
  if (/rugby/.test(text)) return "Rugby";
  if (/premier league|la liga|serie a|bundesliga|champions league|world cup|football|soccer/.test(text)) return "Soccer";
  return null;
}

function simplifyForSearch(s: string): string {
  // TheSportsDB searchevents expects e.g. "Arsenal_vs_Chelsea". Replace
  // spaces with underscores; drop anything past parens or dashes.
  const cleaned = s.split(/[\(\-,]/)[0].trim();
  return cleaned.replace(/\s+/g, "_");
}

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

const STOPWORDS = new Set([
  "the", "and", "vs", "versus", "win", "who", "will", "for", "fc", "cf",
  "afc", "club", "city", "united", "cup", "league", "grand", "prix",
]);
