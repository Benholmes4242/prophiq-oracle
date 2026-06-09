// Tennis match-winner confirm via TheSportsDB (free public key "3").
//
// Verified against the live API (2026-06-09):
//  - eventsday.php?d=YYYY-MM-DD&s=Tennis returns tennis matches per day.
//  - For tennis, strHomeTeam / strAwayTeam are NULL. Players exist ONLY in
//    strEvent as "<Tournament> <PlayerA> vs <PlayerB>".
//  - A naive name search can return wrong sports (e.g. "Wimbledon" hockey).
//    We filter strSport === "Tennis" everywhere.
//
// Scope: match winner ONLY. Outright (draw winner) has no feed in TheSportsDB
// and stays research_grounded. Never throws; on any failure returns
// { kind: "none", reason }.

const TSDB_BASE_TEMPLATE = "https://www.thesportsdb.com/api/v1/json";
const TSDB_TIMEOUT_MS = 10_000;
const PUBLIC_KEY = "3";

export interface TennisMatchCandidate {
  event_id: string;
  player_a: string;
  player_b: string;
  tournament: string | null;
  starts_at: string; // ISO; midday UTC of dateEvent when time missing
  date: string;      // YYYY-MM-DD
}

export type TennisMatchConfirm =
  | { kind: "single"; match: TennisMatchCandidate }
  | { kind: "multiple"; matches: TennisMatchCandidate[] }
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

/**
 * Confirm a tennis match from the resolver's canonical_event. Parses two
 * player surnames, sweeps eventsday.php over a small date window, filters to
 * Tennis, and returns one of single / multiple / none.
 */
export async function confirmTennisMatch(
  canonicalEvent: string,
  approxDateISO: string | null,
): Promise<TennisMatchConfirm> {
  const players = extractPlayers(canonicalEvent);
  if (!players) return { kind: "none", reason: "could not parse two players" };

  const base = `${TSDB_BASE_TEMPLATE}/${readEnv("THESPORTSDB_API_KEY") || PUBLIC_KEY}`;
  const center = approxDateISO ? new Date(`${approxDateISO}T12:00:00Z`) : new Date();
  if (Number.isNaN(center.getTime())) {
    return { kind: "none", reason: "bad approx_date" };
  }
  // Today .. +7d (sweep back 1d as well to catch late-night fixtures).
  const days: string[] = [];
  for (let d = -1; d <= 7; d++) {
    days.push(isoDate(new Date(center.getTime() + d * 86400000)));
  }

  const candidates: TennisMatchCandidate[] = [];
  const aTok = players.a.toLowerCase();
  const bTok = players.b.toLowerCase();

  for (const day of days) {
    const raw = await fetchTennisDay(base, day);
    if (!raw) continue;
    for (const ev of raw) {
      if (String(ev.strSport ?? "").toLowerCase() !== "tennis") continue;
      const strEvent = String(ev.strEvent ?? "").trim();
      if (!strEvent) continue;
      const parsed = parseEventPlayers(strEvent);
      if (!parsed) continue;
      const pa = parsed.a.toLowerCase();
      const pb = parsed.b.toLowerCase();
      const aMatch = surnameMatch(aTok, pa) || surnameMatch(aTok, pb);
      const bMatch = surnameMatch(bTok, pa) || surnameMatch(bTok, pb);
      if (!(aMatch && bMatch)) continue;
      candidates.push({
        event_id: String(ev.idEvent ?? ""),
        player_a: parsed.a,
        player_b: parsed.b,
        tournament: parsed.tournament,
        starts_at: combineDateTime(ev.dateEvent ?? day, ev.strTime ?? null),
        date: ev.dateEvent ?? day,
      });
    }
  }

  if (candidates.length === 0) return { kind: "none", reason: "no tennis match for both players in window" };
  // Dedupe by event_id.
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.event_id)) return false;
    seen.add(c.event_id);
    return true;
  });
  if (unique.length === 1) return { kind: "single", match: unique[0] };
  return { kind: "multiple", matches: unique.slice(0, 6) };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function fetchTennisDay(base: string, day: string): Promise<TSDBRawEvent[] | null> {
  const url = `${base}/eventsday.php?d=${day}&s=Tennis`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TSDB_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json() as { events?: TSDBRawEvent[] | null; event?: TSDBRawEvent[] | null };
    return data.events ?? data.event ?? [];
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Parse "<Tournament> <PlayerA> vs <PlayerB>" -> { a, b, tournament }.
 * The vs separator splits two halves; the LAST whitespace-separated token of
 * the left half is treated as PlayerA's surname-or-full-name, the rest is
 * the tournament. The right half is PlayerB's name. Best-effort; null when
 * the structure is not present. */
export function parseEventPlayers(strEvent: string): { a: string; b: string; tournament: string | null } | null {
  const m = strEvent.match(/^(.*?)\s+(?:vs\.?|v|versus)\s+(.+)$/i);
  if (!m) return null;
  const leftRaw = m[1].trim();
  const right = m[2].trim();
  if (!leftRaw || !right) return null;
  // Strip a trailing tournament suffix on the RIGHT half if it accidentally
  // got glued on (TheSportsDB usually doesn't, but be defensive).
  const left = leftRaw;
  // Split left into [tournament...?] [PlayerA].
  // Heuristic: PlayerA is the LAST capitalised word (or last 1-2 words for
  // double-barrelled names like "De Minaur"). Default to last word.
  const leftTokens = left.split(/\s+/);
  let aName = leftTokens[leftTokens.length - 1] ?? "";
  let tournamentTokens = leftTokens.slice(0, -1);
  // If the second-to-last token looks like a particle ("de", "van", "del",
  // "von", "di"), glue it onto the player's name.
  const PARTICLES = new Set(["de", "van", "del", "della", "von", "di", "la", "le"]);
  if (
    tournamentTokens.length >= 1 &&
    PARTICLES.has(tournamentTokens[tournamentTokens.length - 1].toLowerCase())
  ) {
    aName = `${tournamentTokens[tournamentTokens.length - 1]} ${aName}`;
    tournamentTokens = tournamentTokens.slice(0, -1);
  }
  const tournament = tournamentTokens.join(" ").trim() || null;
  if (!aName) return null;
  return { a: aName, b: right, tournament };
}

/** Parse the resolver's canonical_event into two player surnames.
 * Handles "Alcaraz vs Sinner", "Kyrgios v Moutet", "Boss Open Moutet vs
 * Kyrgios" (tournament prefix). Returns null when fewer than two names. */
export function extractPlayers(canonical: string): { a: string; b: string } | null {
  if (!canonical) return null;
  const m = canonical.match(/(.+?)\s+(?:vs\.?|v|versus)\s+(.+?)(?:\s*[\(\-,]|$)/i);
  if (!m) return null;
  const leftRaw = m[1].trim();
  const rightRaw = m[2].trim();
  if (!leftRaw || !rightRaw) return null;
  // For the left half, take the LAST token (or particle+token) as the
  // player; everything before is tournament words and discarded.
  const leftTokens = leftRaw.split(/\s+/);
  let aName = leftTokens[leftTokens.length - 1] ?? "";
  const PARTICLES = new Set(["de", "van", "del", "della", "von", "di", "la", "le"]);
  if (
    leftTokens.length >= 2 &&
    PARTICLES.has(leftTokens[leftTokens.length - 2].toLowerCase())
  ) {
    aName = `${leftTokens[leftTokens.length - 2]} ${aName}`;
  }
  // Right side: take FIRST 1-2 tokens (first token, plus particle handling).
  const rightTokens = rightRaw.split(/\s+/);
  let bName = rightTokens[0] ?? "";
  if (rightTokens.length >= 2 && PARTICLES.has(rightTokens[0].toLowerCase())) {
    bName = `${rightTokens[0]} ${rightTokens[1]}`;
  }
  if (!aName || !bName) return null;
  return { a: aName, b: bName };
}

/** Case-insensitive surname match: does `needle` (a surname, possibly with
 * a particle) appear as a whole word inside `hay` (a full player name)? */
function surnameMatch(needle: string, hay: string): boolean {
  if (!needle || !hay) return false;
  const n = needle.toLowerCase().trim();
  const h = hay.toLowerCase();
  // Require word-boundary match to avoid e.g. "agut" matching "augustine".
  const re = new RegExp(`(?:^|\\s)${escapeRegex(n)}(?:\\s|$)`);
  return re.test(h);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function combineDateTime(date: string, time: string | null): string {
  const d = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : isoDate(new Date());
  if (time && /^\d{2}:\d{2}/.test(time)) {
    return `${d}T${time.slice(0, 8).padEnd(8, "0")}Z`.replace(/T(\d{2}:\d{2})Z$/, "T$1:00Z");
  }
  return `${d}T12:00:00Z`;
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}
