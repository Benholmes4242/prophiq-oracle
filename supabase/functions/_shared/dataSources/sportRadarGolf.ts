// SportRadar Golf v3 adapter — multi-tour (PGA + DP World + LPGA + Champions
// + Korn Ferry + LIV).
//
// Returns the canonical `{ matched, runners, note }` snapshot shape that
// sport.ts gatherStructuredSources -> hasUsableData and the downstream
// outcome-rewrite expect. Players are the "runners" — name maps to
// `horse` so the existing extractor + rewrite pipeline (favourite-first
// chips, top-N + bucket) works unchanged. No odds in the leaderboard;
// players are sorted leader-first by `position` (with score tiebreak).
//
// Multi-tour design:
//   - Schedules are fetched per (tour, year) and cached in-memory for 24h
//     because they change slowly. The first ask per tour/day pays the
//     ~1 req/sec cost; subsequent asks reuse the cache.
//   - findGolfMatches() returns ALL candidate matches across tours so
//     the picker upstream can decide forecast-vs-clarify.
//   - fetchGolfContext() either honours an explicit (tour_alias,
//     tournament_id) hint from event metadata (structured resubmit from
//     the picker) or runs the single-match heuristic. Multi-match falls
//     through as an empty snapshot — the picker is decided in
//     submit-question before this is called.

const GOLF_BASE = "https://api.sportradar.com/golf/production";
const GOLF_TIMEOUT_MS = 10_000;
const RATE_LIMIT_GAP_MS = 1100; // production keys are ~1 req/sec
const SCHEDULE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type GolfTour = "pga" | "euro" | "lpga" | "champ" | "pgad" | "liv";

export const GOLF_TOUR_NAMES: Record<GolfTour, string> = {
  pga: "PGA Tour",
  euro: "DP World Tour",
  lpga: "LPGA Tour",
  champ: "Champions Tour",
  pgad: "Korn Ferry Tour",
  liv: "LIV Golf League",
};

// Priority-ordered set of tours to search when no tour signal is given.
const DEFAULT_TOURS: GolfTour[] = ["pga", "euro", "lpga", "champ", "pgad", "liv"];

export interface GolfPlayer {
  horse: string;
  position: number | null;
  score: number | null;
  country: string | null;
  odds: null;
}

export interface GolfSnapshot {
  tournament: {
    id: string;
    name: string;
    tour: GolfTour;
    status: string | null;
    start_date: string | null;
    end_date: string | null;
  } | null;
  runners: GolfPlayer[];
  matched: string | null;
  note?: string;
}

export interface GolfMatch {
  tour: GolfTour;
  tour_name: string;
  tournament_id: string;
  tournament_name: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
}

interface GolfHints {
  metadata?: Record<string, unknown> | null;
  title?: string;
  question?: string;
  starts_at?: string;
}

function emptySnapshot(note: string): GolfSnapshot {
  return { tournament: null, runners: [], matched: null, note };
}

// ---------- schedule cache ----------

const scheduleCache = new Map<string, { at: number; data: RawScheduleTournament[] }>();
function cacheKey(tour: GolfTour, year: number): string {
  return `${tour}:${year}`;
}
function readCache(tour: GolfTour, year: number): RawScheduleTournament[] | null {
  const hit = scheduleCache.get(cacheKey(tour, year));
  if (!hit) return null;
  if (Date.now() - hit.at > SCHEDULE_CACHE_TTL_MS) {
    scheduleCache.delete(cacheKey(tour, year));
    return null;
  }
  return hit.data;
}
function writeCache(tour: GolfTour, year: number, data: RawScheduleTournament[]): void {
  scheduleCache.set(cacheKey(tour, year), { at: Date.now(), data });
}

// ---------- public API ----------

/**
 * Find ALL matching tournaments across the priority tour set. The picker
 * uses this to decide forecast-vs-clarify upstream. Sequential per tour
 * to respect SportRadar's ~1 req/sec rate limit.
 */
export async function findGolfMatches(
  apiKey: string,
  hints: GolfHints,
): Promise<{ matches: GolfMatch[]; note: string }> {
  if (!apiKey) return { matches: [], note: "missing SPORTRADAR_GOLF_API_KEY" };

  const text = `${hints.title ?? ""} ${hints.question ?? ""}`.trim();
  const query = parseTournamentName(text);
  if (!query) return { matches: [], note: "could not parse tournament name" };

  const tours = inferTours(text);
  const now = hints.starts_at ? new Date(hints.starts_at) : new Date();
  const years = nearbyYears(now);

  const matches: GolfMatch[] = [];
  let calls = 0;
  for (const tour of tours) {
    for (const year of years) {
      const schedule = await fetchSchedule(apiKey, tour, year, () => calls++);
      if (!schedule) continue;
      const best = matchTournament(schedule, query, now);
      if (best) {
        matches.push({
          tour,
          tour_name: GOLF_TOUR_NAMES[tour],
          tournament_id: best.id ?? "",
          tournament_name: best.name ?? "",
          status: best.status ?? null,
          start_date: best.start_date ?? null,
          end_date: best.end_date ?? null,
        });
      }
    }
  }
  return {
    matches,
    note: `searched ${tours.length} tours (${calls} live calls), found ${matches.length}`,
  };
}

export async function fetchGolfContext(
  apiKey: string,
  hints: GolfHints,
): Promise<GolfSnapshot> {
  if (!apiKey) return emptySnapshot("missing SPORTRADAR_GOLF_API_KEY");

  // Structured-resubmit short-circuit: if event metadata carries the exact
  // tour+tournament from the picker, fetch directly. Skip all name matching.
  const meta = hints.metadata ?? {};
  const pickedTour = readMetaString(meta, "golf_tour_alias");
  const pickedId = readMetaString(meta, "golf_tournament_id");
  if (pickedTour && pickedId && isGolfTour(pickedTour)) {
    const now = hints.starts_at ? new Date(hints.starts_at) : new Date();
    const years = nearbyYears(now);
    let lastStatus: string | null = null;
    let lastName: string | null = null;
    for (const year of years) {
      const lb = await fetchLeaderboard(apiKey, pickedTour, year, pickedId);
      if (!lb) continue;
      lastStatus = lb.status ?? null;
      lastName = lb.name ?? null;
      const runners = mapLeaderboard(lb);
      const name = lb.name ?? readMetaString(meta, "golf_tournament_name") ?? "tournament";
      if (runners.length > 0) {
        return {
          tournament: {
            id: pickedId,
            name,
            tour: pickedTour,
            status: lb.status ?? null,
            start_date: null,
            end_date: null,
          },
          runners,
          matched: `${name} (${pickedTour})`,
          note: `matched ${runners.length} players (structured pick, leaderboard)`,
        };
      }
    }
    // No live leaderboard yet — fall back to the pre-tournament entry list
    // from summary.field so a scheduled tournament still comes back
    // feed_backed with real player names.
    for (const year of years) {
      const summary = await fetchSummary(apiKey, pickedTour, year, pickedId);
      if (!summary) continue;
      const fieldPlayers = mapField(summary);
      const name = summary.name ?? lastName ?? readMetaString(meta, "golf_tournament_name") ?? "tournament";
      if (fieldPlayers.length > 0) {
        return {
          tournament: {
            id: pickedId,
            name,
            tour: pickedTour,
            status: summary.status ?? lastStatus,
            start_date: null,
            end_date: null,
          },
          runners: fieldPlayers,
          matched: `${name} (${pickedTour})`,
          note: `matched ${fieldPlayers.length} entrants (structured pick, summary.field)`,
        };
      }
    }
    return emptySnapshot(
      `picked tournament ${pickedId} matched but has neither leaderboard nor field yet (${lastStatus ?? "unknown"})`,
    );
  }

  // Single-match heuristic (legacy path): scan tours, fetch leaderboard for
  // the first confident match. Multi-match falls through to empty so the
  // upstream picker can decide.
  const { matches } = await findGolfMatches(apiKey, hints);
  if (matches.length === 0) {
    return emptySnapshot(`no golf tournament matched`);
  }
  if (matches.length > 1) {
    return emptySnapshot(
      `${matches.length} candidate tournaments across tours — picker required`,
    );
  }

  const m = matches[0];
  const now = hints.starts_at ? new Date(hints.starts_at) : new Date();
  const years = nearbyYears(now);
  // Try the year the schedule match came from first; fall back to nearby
  // years if leaderboard fetch fails.
  const year = m.start_date ? new Date(m.start_date).getUTCFullYear() : years[0];
  const yearsToTry = [year, ...years.filter((y) => y !== year)];
  for (const y of yearsToTry) {
    const lb = await fetchLeaderboard(apiKey, m.tour, y, m.tournament_id);
    if (!lb) continue;
    const runners = mapLeaderboard(lb);
    if (runners.length > 0) {
      return {
        tournament: {
          id: m.tournament_id,
          name: m.tournament_name,
          tour: m.tour,
          status: m.status,
          start_date: m.start_date,
          end_date: m.end_date,
        },
        runners,
        matched: `${m.tournament_name} (${m.tour})`,
        note: `matched ${runners.length} players (leaderboard)`,
      };
    }
    // No live leaderboard — try summary.field for the pre-tournament entry list.
    const summary = await fetchSummary(apiKey, m.tour, y, m.tournament_id);
    if (summary) {
      const fieldPlayers = mapField(summary);
      if (fieldPlayers.length > 0) {
        return {
          tournament: {
            id: m.tournament_id,
            name: m.tournament_name,
            tour: m.tour,
            status: summary.status ?? m.status,
            start_date: m.start_date,
            end_date: m.end_date,
          },
          runners: fieldPlayers,
          matched: `${m.tournament_name} (${m.tour})`,
          note: `matched ${fieldPlayers.length} entrants (summary.field)`,
        };
      }
    }
  }
  return emptySnapshot(
    `tournament ${m.tournament_name} matched but no leaderboard or field yet (${m.status ?? "unknown"})`,
  );
}

// ---------- hint parsing ----------

export function parseTournamentName(text: string): string | null {
  if (!text) return null;
  let t = text.toLowerCase();
  t = t.replace(/\b(who(?:'s|s| is| will)?\s+(?:going to\s+)?(?:win|winning|wins)|will\s+win|to\s+win|odds\s+to\s+win|forecast\s+for|prediction\s+for|pick\s+for)\b/gi, " ");
  t = t.replace(/\b(today|tonight|tomorrow|this\s+week|next\s+week|this\s+weekend|on\s+sunday|on\s+saturday)\b/gi, " ");
  t = t.replace(/\b(the\s+golf|golf|tournament|championship\s+golf)\b/gi, " ");
  // Strip explicit tour qualifiers so the name itself matches the schedule.
  t = t.replace(/\b(pga tour|pga|dp world(?:\s+tour)?|european\s+tour|euro\s+tour|lpga(?:\s+tour)?|champions\s+tour|senior\s+(?:pga\s+)?tour?|korn\s+ferry(?:\s+tour)?|liv(?:\s+golf(?:\s+league)?)?)\b/gi, " ");
  t = t.replace(/[?!.]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/^the\s+/i, "").trim();
  if (t.length < 3) return null;
  return t;
}

export function inferTours(text: string): GolfTour[] {
  const lower = text.toLowerCase();
  if (/\b(dp world|european\s+tour|euro\s+tour)\b/.test(lower)) return ["euro", "pga", "lpga"];
  if (/\blpga\b|\bwomen'?s\b/.test(lower)) return ["lpga", "pga", "euro"];
  if (/\b(korn\s+ferry)\b/.test(lower)) return ["pgad", "pga"];
  if (/\b(champions\s+tour|senior(?:\s+pga)?\b)/.test(lower)) return ["champ", "pga"];
  if (/\bliv(?:\s+golf)?\b/.test(lower)) return ["liv", "pga"];
  if (/\bpga\s+tour\b/.test(lower)) return ["pga"];
  return DEFAULT_TOURS;
}

function nearbyYears(now: Date): number[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  if (m >= 10) return [y, y + 1];
  if (m <= 2) return [y, y - 1];
  return [y];
}

function isGolfTour(s: string): s is GolfTour {
  return s === "pga" || s === "euro" || s === "lpga" || s === "champ" || s === "pgad" || s === "liv";
}

function readMetaString(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ---------- API ----------

interface RawScheduleTournament {
  id?: string;
  name?: string;
  event_type?: string;
  start_date?: string;
  end_date?: string;
  course_timezone?: string;
  status?: string;
}
interface RawScheduleResp {
  tour?: string;
  season?: { year?: number };
  tournaments?: RawScheduleTournament[];
}

interface RawLeaderboardPlayer {
  id?: string;
  first_name?: string;
  last_name?: string;
  abbr_name?: string;
  country?: string;
  position?: number | string;
  tied?: boolean;
  score?: number | string;
  strokes?: number | string;
}
interface RawLeaderboardResp {
  id?: string;
  name?: string;
  status?: string;
  leaderboard?: RawLeaderboardPlayer[];
}

interface RawSummaryFieldPlayer {
  id?: string;
  first_name?: string;
  last_name?: string;
  abbr_name?: string;
  country?: string;
}
interface RawSummaryResp {
  id?: string;
  name?: string;
  status?: string;
  field?: RawSummaryFieldPlayer[];
}

async function fetchSchedule(
  apiKey: string,
  tour: GolfTour,
  year: number,
  onLiveCall?: () => void,
): Promise<RawScheduleTournament[] | null> {
  const cached = readCache(tour, year);
  if (cached) return cached;
  // Respect rate limit ONLY on actual outbound calls.
  await sleep(RATE_LIMIT_GAP_MS);
  onLiveCall?.();
  const url = `${GOLF_BASE}/${tour}/v3/en/${year}/tournaments/schedule.json?api_key=${encodeURIComponent(apiKey)}`;
  const data = await fetchJson<RawScheduleResp>(url);
  if (!data) return null;
  const list = Array.isArray(data.tournaments) ? data.tournaments : [];
  writeCache(tour, year, list);
  return list;
}

async function fetchLeaderboard(
  apiKey: string,
  tour: GolfTour,
  year: number,
  tournamentId: string,
): Promise<RawLeaderboardResp | null> {
  await sleep(RATE_LIMIT_GAP_MS);
  const url = `${GOLF_BASE}/${tour}/v3/en/${year}/tournaments/${tournamentId}/leaderboard.json?api_key=${encodeURIComponent(apiKey)}`;
  return await fetchJson<RawLeaderboardResp>(url);
}

/**
 * Pre-tournament field. For a `scheduled`/`created` tournament, the
 * `summary` endpoint exposes a `field` array of real entrants (verified
 * 2026-06-08). The `field`/`entries` sub-paths 404. Use this to surface
 * a real player list before the leaderboard exists, so we can still emit
 * feed_backed predictions instead of "field still forming".
 */
async function fetchSummary(
  apiKey: string,
  tour: GolfTour,
  year: number,
  tournamentId: string,
): Promise<RawSummaryResp | null> {
  await sleep(RATE_LIMIT_GAP_MS);
  const url = `${GOLF_BASE}/${tour}/v3/en/${year}/tournaments/${tournamentId}/summary.json?api_key=${encodeURIComponent(apiKey)}`;
  return await fetchJson<RawSummaryResp>(url);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOLF_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[sportRadarGolf] non-2xx ${res.status} for ${url.replace(/api_key=[^&]+/, "api_key=***")}`);
      return null;
    }
    return await res.json() as T;
  } catch (e) {
    console.warn(`[sportRadarGolf] fetch error: ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- matching ----------

function matchTournament(
  tournaments: RawScheduleTournament[],
  query: string,
  now: Date,
): RawScheduleTournament | null {
  const q = query.toLowerCase().trim();
  const PREFERRED_STATUS = new Set(["inprogress", "scheduled", "created"]);
  let best: { t: RawScheduleTournament; score: number } | null = null;
  for (const t of tournaments) {
    const name = (t.name ?? "").toLowerCase().trim();
    if (!name) continue;
    let score = 0;
    if (name === q) score += 100;
    else if (name.includes(q) || q.includes(name)) score += 50;
    else {
      const qTokens = q.split(/\s+/).filter((w) => w.length >= 3);
      const nTokens = name.split(/\s+/);
      const hits = qTokens.filter((w) => nTokens.some((n) => n.includes(w))).length;
      if (hits === 0) continue;
      score += hits * 10;
    }
    if (t.status && PREFERRED_STATUS.has(t.status.toLowerCase())) score += 5;
    if (t.start_date) {
      const sd = new Date(t.start_date).getTime();
      if (!Number.isNaN(sd)) {
        const days = Math.abs(sd - now.getTime()) / 86_400_000;
        if (days <= 7) score += 8;
        else if (days <= 30) score += 3;
        else if (days > 200) score -= 5;
      }
    }
    if (!best || score > best.score) best = { t, score };
  }
  if (!best || best.score < 10) return null;
  return best.t;
}

function mapLeaderboard(lb: RawLeaderboardResp): GolfPlayer[] {
  const rows = Array.isArray(lb.leaderboard) ? lb.leaderboard : [];
  const players: GolfPlayer[] = [];
  for (const p of rows) {
    const first = (p.first_name ?? "").trim();
    const last = (p.last_name ?? "").trim();
    const fallback = (p.abbr_name ?? "").trim();
    const name = first || last ? `${first} ${last}`.trim() : fallback;
    if (!name) continue;
    const position = numOrNull(p.position);
    const score = numOrNull(p.score);
    players.push({
      horse: name,
      position,
      score,
      country: p.country ?? null,
      odds: null,
    });
  }
  if (players.length === 0 || players.every((p) => p.position === null)) {
    return [];
  }
  players.sort((a, b) => {
    if (a.position === null && b.position === null) return 0;
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    if (a.position !== b.position) return a.position - b.position;
    const sa = a.score ?? 0;
    const sb = b.score ?? 0;
    return sa - sb;
  });
  return players;
}

/**
 * Map summary.field entrants (pre-tournament) into the GolfPlayer shape.
 * No leaderboard positions/scores exist yet, so positions are null and the
 * ordering is whatever the API returned (the consensus models + research
 * supply the form-based ranking). Empty if nothing usable.
 */
function mapField(s: RawSummaryResp): GolfPlayer[] {
  const rows = Array.isArray(s.field) ? s.field : [];
  const players: GolfPlayer[] = [];
  for (const p of rows) {
    const first = (p.first_name ?? "").trim();
    const last = (p.last_name ?? "").trim();
    const fallback = (p.abbr_name ?? "").trim();
    const name = first || last ? `${first} ${last}`.trim() : fallback;
    if (!name) continue;
    players.push({
      horse: name,
      position: null,
      score: null,
      country: p.country ?? null,
      odds: null,
    });
  }
  return players;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
