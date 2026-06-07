// SportRadar Golf v3 adapter (production).
//
// Returns the canonical `{ matched, runners, note }` snapshot shape that
// sport.ts gatherStructuredSources -> hasUsableData and the downstream
// outcome-rewrite expect. Players are the "runners" — name maps to
// `horse` so the existing extractor + rewrite pipeline (favourite-first
// chips, top-N + bucket) works unchanged. No odds in the leaderboard;
// players are sorted leader-first by `position` (with score tiebreak).

const GOLF_BASE = "https://api.sportradar.com/golf/production";
const GOLF_TIMEOUT_MS = 10_000;
const RATE_LIMIT_GAP_MS = 1100; // production keys are ~1 req/sec

export type GolfTour = "pga" | "euro" | "lpga" | "champ" | "pgad" | "oly" | "liv";

// Tours to fan out across (kept small to respect rate limits). Order matters
// — first match wins. PGA covers the bulk of asked tournaments; euro + lpga
// pick up DP World / European Tour and LPGA. Tour can also be hinted from
// the question text to short-circuit fan-out.
const DEFAULT_TOURS: GolfTour[] = ["pga", "euro", "lpga"];

export interface GolfPlayer {
  // Shape mirrors RacingRunner so the existing extractor + outcome rewrite
  // reuse cleanly. `horse` carries the player's "First Last" name.
  horse: string;
  position: number | null;
  score: number | null;
  country: string | null;
  // Always null for golf — kept for shape parity with racing runners.
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
  matched: string | null; // e.g. "Memorial Tournament (pga)"
  note?: string;
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

export async function fetchGolfContext(
  apiKey: string,
  hints: GolfHints,
): Promise<GolfSnapshot> {
  if (!apiKey) return emptySnapshot("missing SPORTRADAR_GOLF_API_KEY");

  const text = `${hints.title ?? ""} ${hints.question ?? ""}`.trim();
  const tournamentQuery = parseTournamentName(text);
  if (!tournamentQuery) return emptySnapshot("could not parse tournament name");

  const tours = inferTours(text);

  // Compute years to search: current year, plus next year if we're in Q4
  // (tournaments in early next year are already on the schedule).
  const now = hints.starts_at ? new Date(hints.starts_at) : new Date();
  const years = nearbyYears(now);

  // Fan out small: try each (tour, year) sequentially with rate-limit gap.
  for (const tour of tours) {
    for (const year of years) {
      const schedule = await fetchSchedule(apiKey, tour, year);
      if (!schedule) continue;
      const tournament = matchTournament(schedule, tournamentQuery, now);
      if (!tournament) {
        await sleep(RATE_LIMIT_GAP_MS);
        continue;
      }
      await sleep(RATE_LIMIT_GAP_MS);
      const leaderboard = await fetchLeaderboard(apiKey, tour, year, tournament.id);
      if (!leaderboard) {
        return emptySnapshot(`leaderboard fetch failed for ${tournament.name}`);
      }
      const runners = mapLeaderboard(leaderboard);
      if (runners.length === 0) {
        // Pre-tournament with no leaderboard yet — honest empty snapshot so
        // trust layer falls to research_grounded rather than feed_backed.
        return emptySnapshot(
          `tournament ${tournament.name} matched but no leaderboard positions yet (${tournament.status ?? "unknown status"})`,
        );
      }
      return {
        tournament: {
          id: tournament.id,
          name: tournament.name,
          tour,
          status: tournament.status ?? null,
          start_date: tournament.start_date ?? null,
          end_date: tournament.end_date ?? null,
        },
        runners,
        matched: `${tournament.name} (${tour})`,
        note: `matched ${runners.length} players`,
      };
    }
  }

  return emptySnapshot(`no golf tournament matched for "${tournamentQuery}"`);
}

// ---------- hint parsing ----------

function parseTournamentName(text: string): string | null {
  if (!text) return null;
  let t = text.toLowerCase();
  // Strip common question framing.
  t = t.replace(/\b(who(?:'s|s| is| will)?\s+(?:going to\s+)?(?:win|winning|wins)|will\s+win|to\s+win|odds\s+to\s+win|forecast\s+for|prediction\s+for|pick\s+for)\b/gi, " ");
  t = t.replace(/\b(today|tonight|tomorrow|this\s+week|next\s+week|this\s+weekend|on\s+sunday|on\s+saturday)\b/gi, " ");
  t = t.replace(/\b(the\s+golf|golf|tournament)\b/gi, " ");
  t = t.replace(/[?!.]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  // Drop a leading "the".
  t = t.replace(/^the\s+/i, "").trim();
  if (t.length < 3) return null;
  return t;
}

function inferTours(text: string): GolfTour[] {
  const lower = text.toLowerCase();
  if (/\b(dp world|european tour|euro tour)\b/.test(lower)) return ["euro", "pga", "lpga"];
  if (/\blpga\b/.test(lower)) return ["lpga", "pga", "euro"];
  if (/\bkorn ferry\b/.test(lower)) return ["pgad", "pga"];
  if (/\bchampions tour\b|\bsenior\b/.test(lower)) return ["champ", "pga"];
  if (/\bliv\b/.test(lower)) return ["liv", "pga"];
  return DEFAULT_TOURS;
}

function nearbyYears(now: Date): number[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  // Late in the year, also peek at next season.
  if (m >= 10) return [y, y + 1];
  // Early in the year, the previous season may still hold winter events.
  if (m <= 2) return [y, y - 1];
  return [y];
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

async function fetchSchedule(
  apiKey: string,
  tour: GolfTour,
  year: number,
): Promise<RawScheduleTournament[] | null> {
  // IMPORTANT: tour comes BEFORE v3 in the path.
  const url = `${GOLF_BASE}/${tour}/v3/en/${year}/tournaments/schedule.json?api_key=${encodeURIComponent(apiKey)}`;
  const data = await fetchJson<RawScheduleResp>(url);
  if (!data) return null;
  return Array.isArray(data.tournaments) ? data.tournaments : [];
}

async function fetchLeaderboard(
  apiKey: string,
  tour: GolfTour,
  year: number,
  tournamentId: string,
): Promise<RawLeaderboardResp | null> {
  const url = `${GOLF_BASE}/${tour}/v3/en/${year}/tournaments/${tournamentId}/leaderboard.json?api_key=${encodeURIComponent(apiKey)}`;
  return await fetchJson<RawLeaderboardResp>(url);
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
  // Score each candidate: name overlap + status preference + date proximity.
  const PREFERRED_STATUS = new Set(["inprogress", "scheduled", "created"]);
  let best: { t: RawScheduleTournament; score: number } | null = null;
  for (const t of tournaments) {
    const name = (t.name ?? "").toLowerCase().trim();
    if (!name) continue;
    let score = 0;
    if (name === q) score += 100;
    else if (name.includes(q) || q.includes(name)) score += 50;
    else {
      // Token overlap.
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
    // Skip rows with no position AT ALL — pre-tournament with no positions
    // means we should emit an empty snapshot (-> research_grounded).
    players.push({
      horse: name,
      position,
      score,
      country: p.country ?? null,
      odds: null,
    });
  }
  // If every row is positionless, treat as pre-tournament (return empty so
  // the snapshot falls through to research_grounded).
  if (players.length === 0 || players.every((p) => p.position === null)) {
    return [];
  }
  // Sort leader-first: position ascending, then score ascending, then
  // preserve original order. Players with null position go to the back.
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

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
