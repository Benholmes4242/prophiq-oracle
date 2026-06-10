// Formula 1 race-winner + drivers championship confirm via the free,
// keyless Jolpica F1 API (Ergast successor). Tested live 2026-06-09.
//
// Endpoints:
//   - /ergast/f1/<year>.json          season race list
//   - /ergast/f1/<year>/next.json     next upcoming race
//   - /ergast/f1/<year>/drivers.json  driver field
//   - /ergast/f1/<year>/driverStandings.json
//
// F1 is a FIELD sport (rank the grid), like golf — NOT an X-vs-Y sport.
// Match output: drivers ordered by championship position (full names),
// with any drivers not yet in standings appended after. The
// "Any other driver" bucket is appended by the caller (sportGrounding /
// submit-question) using the same MAX_NAMED pattern as golf/racing.
//
// Never throws; on any failure returns { kind: "none", reason }.

const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";
const JOLPICA_TIMEOUT_MS = 10_000;

export interface F1RaceConfirm {
  kind: "race";
  season: number;
  round: number;
  race_name: string;
  circuit: string | null;
  date: string;           // YYYY-MM-DD
  starts_at: string;      // ISO (midday UTC when time unknown)
  drivers: string[];      // ordered full names (standings first)
}

export interface F1ChampionshipConfirm {
  kind: "championship";
  season: number;
  drivers: string[];          // standings-ordered full names
  leader_points: number | null;
  round_as_of: number | null; // last round counted into standings (best-effort)
  starts_at: string | null;   // championship resolves at season end
}

export type F1RaceResult =
  | F1RaceConfirm
  | { kind: "none"; reason: string };

export type F1ChampionshipResult =
  | F1ChampionshipConfirm
  | { kind: "none"; reason: string };

export interface F1ConstructorsConfirm {
  kind: "constructors_championship";
  season: number;
  teams: string[];           // standings-ordered constructor (team) names
  leader_points: number | null;
  round_as_of: number | null;
  starts_at: string | null;
}

export type F1ConstructorsResult =
  | F1ConstructorsConfirm
  | { kind: "none"; reason: string };

/** True when the canonical/question text frames a CONSTRUCTORS (teams)
 *  championship. Mutually exclusive with isF1DriversChampionshipIntent
 *  (which short-circuits on /constructor/). */
export function isF1ConstructorsChampionshipIntent(text: string): boolean {
  const s = (text ?? "").toLowerCase();
  if (!s) return false;
  if (!/\bconstructor(s)?\b/.test(s)) return false;
  if (/\b(championship|title|cup|trophy)\b/.test(s)) return true;
  if (/\b(f1|formula\s*(1|one))\b/.test(s)) return true;
  return false;
}

/** True when the canonical/question text frames a DRIVERS championship,
 *  not a single race. "Constructors championship" is intentionally NOT
 *  matched here — that's a teams question and out of scope. */
export function isF1DriversChampionshipIntent(text: string): boolean {
  const s = (text ?? "").toLowerCase();
  if (!s) return false;
  if (/\bconstructor(s)?\b/.test(s)) return false; // teams, out of scope
  if (/\bdrivers?[''']?\s*championship\b/.test(s)) return true;
  if (/\bworld\s*champion(ship)?\b/.test(s)) return true;
  if (/\bf1\s*title\b/.test(s) || /\bformula\s*(1|one)\s*title\b/.test(s)) return true;
  // bare "championship" / "title" only counts with f1/formula context
  if (/\b(championship|title)\b/.test(s) && /\b(f1|formula\s*(1|one))\b/.test(s)) return true;
  return false;
}

interface JolpicaDriver {
  driverId?: string;
  givenName?: string;
  familyName?: string;
  code?: string | null;
}
interface JolpicaStanding {
  position?: string;
  points?: string;
  Driver?: JolpicaDriver;
}
interface JolpicaRace {
  season?: string;
  round?: string;
  raceName?: string;
  date?: string;
  time?: string;
  Circuit?: { circuitName?: string };
}

export async function confirmF1Race(
  canonicalEvent: string,
  approxDateISO: string | null,
): Promise<F1RaceResult> {
  const season = inferSeason(approxDateISO);

  const [races, drivers, standings] = await Promise.all([
    fetchSeasonRaces(season),
    fetchDrivers(season),
    fetchStandings(season),
  ]);

  if (drivers.length === 0 && standings.length === 0) {
    return { kind: "none", reason: `no F1 drivers for season ${season}` };
  }

  // Choose which race to ground.
  let race: JolpicaRace | null = null;
  const canonical = (canonicalEvent ?? "").toLowerCase();
  const looksNext = /\bnext\b/.test(canonical) || canonical.trim() === "";
  const gpName = stripNoise(canonical);

  if (gpName && races.length > 0) {
    race = races.find((r) => {
      const name = String(r.raceName ?? "").toLowerCase();
      if (!name) return false;
      // simple substring on the location token (e.g. "barcelona" in "Barcelona Grand Prix")
      return tokens(gpName).some((t) => t.length >= 3 && name.includes(t));
    }) ?? null;
  }
  if (!race && looksNext) {
    race = await fetchNextRace(season);
  }
  if (!race) {
    return { kind: "none", reason: `no F1 race matched canonical="${canonicalEvent}"` };
  }

  // Build ordered driver field: standings first (by position), then any
  // drivers not yet in standings appended in driver-list order.
  const standingsOrdered = [...standings].sort((a, b) => {
    const pa = Number(a.position ?? "999");
    const pb = Number(b.position ?? "999");
    return pa - pb;
  });
  const standingNames: string[] = [];
  const seen = new Set<string>();
  for (const s of standingsOrdered) {
    const name = fullName(s.Driver);
    if (name && !seen.has(name)) {
      standingNames.push(name);
      seen.add(name);
    }
  }
  for (const d of drivers) {
    const name = fullName(d);
    if (name && !seen.has(name)) {
      standingNames.push(name);
      seen.add(name);
    }
  }
  if (standingNames.length === 0) {
    return { kind: "none", reason: "F1 driver field empty after merge" };
  }

  const date = String(race.date ?? "").match(/^\d{4}-\d{2}-\d{2}$/)
    ? String(race.date)
    : (approxDateISO ?? new Date().toISOString().slice(0, 10));
  const time = String(race.time ?? "");
  const startsAt = /^\d{2}:\d{2}/.test(time)
    ? `${date}T${time.replace("Z", "").slice(0, 8).padEnd(8, "0")}Z`.replace(
        /T(\d{2}:\d{2})Z$/,
        "T$1:00Z",
      )
    : `${date}T12:00:00Z`;

  return {
    kind: "race",
    season,
    round: Number(race.round ?? "0") || 0,
    race_name: String(race.raceName ?? "").trim() || "Formula 1 Grand Prix",
    circuit: race.Circuit?.circuitName?.trim() || null,
    date,
    starts_at: startsAt,
    drivers: standingNames,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function inferSeason(approxDateISO: string | null): number {
  if (approxDateISO && /^\d{4}-\d{2}-\d{2}$/.test(approxDateISO)) {
    return Number(approxDateISO.slice(0, 4));
  }
  return new Date().getUTCFullYear();
}

function stripNoise(s: string): string {
  return s
    .replace(/\b(formula\s*1|formula\s*one|f1|grand\s*prix|gp|\d{4})\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return s.split(/\s+/).filter((t) => t.length > 0);
}

function fullName(d: JolpicaDriver | undefined): string | null {
  if (!d) return null;
  const g = String(d.givenName ?? "").trim();
  const f = String(d.familyName ?? "").trim();
  if (!g && !f) return null;
  return [g, f].filter(Boolean).join(" ");
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const url = `${JOLPICA_BASE}${path}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), JOLPICA_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

interface MRDataEnvelope<T> {
  MRData?: T;
}

async function fetchSeasonRaces(year: number): Promise<JolpicaRace[]> {
  const body = await fetchJson<MRDataEnvelope<{ RaceTable?: { Races?: JolpicaRace[] } }>>(
    `/${year}.json?limit=100`,
  );
  return body?.MRData?.RaceTable?.Races ?? [];
}

async function fetchNextRace(year: number): Promise<JolpicaRace | null> {
  const body = await fetchJson<MRDataEnvelope<{ RaceTable?: { Races?: JolpicaRace[] } }>>(
    `/${year}/next.json`,
  );
  const races = body?.MRData?.RaceTable?.Races ?? [];
  return races[0] ?? null;
}

async function fetchDrivers(year: number): Promise<JolpicaDriver[]> {
  const body = await fetchJson<MRDataEnvelope<{ DriverTable?: { Drivers?: JolpicaDriver[] } }>>(
    `/${year}/drivers.json?limit=100`,
  );
  return body?.MRData?.DriverTable?.Drivers ?? [];
}

async function fetchStandings(year: number): Promise<JolpicaStanding[]> {
  const body = await fetchJson<
    MRDataEnvelope<{
      StandingsTable?: {
        StandingsLists?: Array<{ DriverStandings?: JolpicaStanding[] }>;
      };
    }>
  >(`/${year}/driverStandings.json`);
  return body?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? [];
}

/** Drivers championship outright — reuses the season standings + driver list
 *  already used by confirmF1Race. Standings position IS the title-contention
 *  order. Returns "none" pre-season (empty standings) so the caller falls
 *  back to research_grounded. */
export async function confirmF1Championship(
  approxDateISO: string | null,
): Promise<F1ChampionshipResult> {
  const season = inferSeason(approxDateISO);
  const [drivers, standings] = await Promise.all([
    fetchDrivers(season),
    fetchStandings(season),
  ]);

  if (standings.length === 0) {
    return { kind: "none", reason: `no F1 standings yet for season ${season}` };
  }

  const standingsOrdered = [...standings].sort((a, b) => {
    const pa = Number(a.position ?? "999");
    const pb = Number(b.position ?? "999");
    return pa - pb;
  });
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const s of standingsOrdered) {
    const name = fullName(s.Driver);
    if (name && !seen.has(name)) { ordered.push(name); seen.add(name); }
  }
  for (const d of drivers) {
    const name = fullName(d);
    if (name && !seen.has(name)) { ordered.push(name); seen.add(name); }
  }
  if (ordered.length < 2) {
    return { kind: "none", reason: "F1 driver field too small for championship" };
  }

  const leaderPointsRaw = standingsOrdered[0]?.points;
  const leaderPoints = leaderPointsRaw != null && Number.isFinite(Number(leaderPointsRaw))
    ? Number(leaderPointsRaw)
    : null;

  // Best-effort: Jolpica driverStandings doesn't include round here; we leave
  // round_as_of null. Callers can surface "after round N" via a later fetch.
  return {
    kind: "championship",
    season,
    drivers: ordered,
    leader_points: leaderPoints,
    round_as_of: null,
    starts_at: null,
  };
}

interface JolpicaConstructor {
  constructorId?: string;
  name?: string;
  nationality?: string;
}
interface JolpicaConstructorStanding {
  position?: string;
  points?: string;
  Constructor?: JolpicaConstructor;
}

async function fetchConstructorStandings(year: number): Promise<JolpicaConstructorStanding[]> {
  const body = await fetchJson<
    MRDataEnvelope<{
      StandingsTable?: {
        StandingsLists?: Array<{ ConstructorStandings?: JolpicaConstructorStanding[] }>;
      };
    }>
  >(`/${year}/constructorStandings.json`);
  return body?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? [];
}

/** Constructors championship outright — reuses constructorStandings as the
 *  TEAM field. NEVER falls back to driver names; returns "none" pre-season
 *  (empty standings) so the caller routes to research_grounded. */
export async function confirmF1Constructors(
  approxDateISO: string | null,
): Promise<F1ConstructorsResult> {
  const season = inferSeason(approxDateISO);
  const standings = await fetchConstructorStandings(season);

  if (standings.length === 0) {
    return { kind: "none", reason: `no F1 constructor standings yet for season ${season}` };
  }

  const ordered = [...standings]
    .sort((a, b) => Number(a.position ?? "999") - Number(b.position ?? "999"));
  const teams: string[] = [];
  const seen = new Set<string>();
  for (const s of ordered) {
    const name = String(s.Constructor?.name ?? "").trim();
    if (name && !seen.has(name)) { teams.push(name); seen.add(name); }
  }
  if (teams.length < 2) {
    return { kind: "none", reason: "F1 constructor field too small for championship" };
  }

  const leaderPointsRaw = ordered[0]?.points;
  const leaderPoints = leaderPointsRaw != null && Number.isFinite(Number(leaderPointsRaw))
    ? Number(leaderPointsRaw)
    : null;

  return {
    kind: "constructors_championship",
    season,
    teams,
    leader_points: leaderPoints,
    round_as_of: null,
    starts_at: null,
  };
}
