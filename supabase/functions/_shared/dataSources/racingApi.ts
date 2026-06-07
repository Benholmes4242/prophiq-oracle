// The Racing API adapter (https://api.theracingapi.com).
//
// Standard plan + advanced add-on: UK/Irish + North American racecards
// with runners and 20+ bookmaker odds. Auth is HTTP Basic.
//
// Returns the canonical `{ matched, ..., note }` shape consumed by
// sport.ts gatherStructuredSources -> hasUsableData. CRITICAL: only
// return a non-null `matched` when a specific race (course + off-time)
// is actually found on the day's racecard — otherwise the trust layer
// will mis-classify the forecast as feed_backed.

const RACING_API_BASE = "https://api.theracingapi.com";
const RACING_API_TIMEOUT_MS = 10_000;

export interface RacingRunner {
  horse: string;
  jockey: string | null;
  trainer: string | null;
  number: string | null;
  draw: string | null;
  age: string | null;
  sex: string | null;
  lbs: string | null;
  ofr: string | null;
  odds: Array<{ bookmaker: string; fractional?: string | null; decimal?: number | null }> | null;
}

export interface RacingRace {
  race_id: string | null;
  course: string;
  region: string | null;
  off_time: string | null; // local race time, e.g. "14:20"
  off_dt: string | null;
  race_name: string | null;
  race_class: string | null;
  field_size: string | null;
  distance: string | null;
  going: string | null;
  betting_forecast: string | null;
  runners: RacingRunner[];
}

export interface RacingSnapshot {
  race: RacingRace | null;
  runners: RacingRunner[];
  matched: string | null; // e.g. "Kempton 14:20"
  note?: string;
}

interface RacingHints {
  metadata?: Record<string, unknown> | null;
  title?: string;
  question?: string;
  starts_at?: string;
}

export async function fetchRacingContext(
  username: string,
  password: string,
  hints: RacingHints,
): Promise<RacingSnapshot> {
  const parsed = parseRacingHints(hints);
  if (!parsed.course || !parsed.date) {
    return emptySnapshot("missing course or date hint");
  }

  // Route US/CAN tracks (advanced North America add-on) separately from the
  // UK/IRE Standard plan. They use a different two-step endpoint set and a
  // different runner shape.
  if (isNorthAmericanTrack(parsed.course)) {
    return await fetchNorthAmericaContext(username, password, parsed);
  }

  // Standard plan only serves today/tomorrow (Europe/London). Pro is required
  // for arbitrary dates — we don't have it, so anything else stays low-data.
  const day = mapDateToDay(parsed.date);
  if (!day) {
    return emptySnapshot("Standard plan covers today/tomorrow only");
  }

  const cards = await fetchRacecards(username, password, day);
  if (!cards) {
    return emptySnapshot("racecards fetch failed or empty");
  }

  const race = matchRace(cards, parsed.course, parsed.time);
  if (!race) {
    return emptySnapshot(
      `no race matched for ${parsed.course}${parsed.time ? ` ${parsed.time}` : ""} on ${parsed.date}`,
    );
  }
  if (race.runners.length === 0) {
    return emptySnapshot("matched race has no runners published yet");
  }

  return {
    race,
    runners: race.runners,
    matched: `${race.course}${race.off_time ? ` ${race.off_time}` : ""}`,
    note: `matched ${race.runners.length} runners`,
  };
}


/** YYYY-MM-DD in Europe/London. */
function londonDate(d: Date): string {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function mapDateToDay(date: string): "today" | "tomorrow" | null {
  const now = new Date();
  const today = londonDate(now);
  const tomorrow = londonDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (date === today) return "today";
  if (date === tomorrow) return "tomorrow";
  return null;
}

function emptySnapshot(note: string): RacingSnapshot {
  return { race: null, runners: [], matched: null, note };
}

// ---------- hint parsing ----------

interface ParsedHints {
  course: string | null;
  time: string | null; // HH:MM 24h
  date: string | null; // YYYY-MM-DD
  raceNumber: number | null; // e.g. "race 5" -> 5 (NA cards)
}


function parseRacingHints(hints: RacingHints): ParsedHints {
  const text = [hints.title ?? "", hints.question ?? ""].join(" ");

  // off-time: "2:20", "14:20", "2.20pm"
  let time: string | null = null;
  const timeMatch = text.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    const ap = (timeMatch[3] ?? "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    else if (ap === "am" && h === 12) h = 0;
    // Heuristic: racing afternoon cards — if no am/pm and hour <= 6, assume PM.
    else if (!ap && h >= 1 && h <= 6) h += 12;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }

  // course: "at <Course>" or known venue list
  let course: string | null = null;
  const atMatch = text.match(/\bat\s+([A-Z][A-Za-z' -]{2,})/);
  if (atMatch) course = atMatch[1].trim();
  if (!course) {
    const venues = [
      "Kempton", "Kempton Park", "Cheltenham", "Aintree", "Ascot", "Epsom",
      "Newmarket", "Goodwood", "Sandown", "Doncaster", "Chester", "Hexham",
      "York", "Wetherby", "Lingfield", "Wolverhampton", "Southwell",
      "Leopardstown", "Punchestown", "Fairyhouse", "Curragh", "Naas",
      // US / Canada (North America advanced add-on)
      "Churchill Downs", "Belmont", "Belmont Park", "Saratoga", "Santa Anita",
      "Del Mar", "Gulfstream", "Gulfstream Park", "Keeneland", "Aqueduct",
      "Pimlico", "Parx", "Parx Racing", "Finger Lakes", "Louisiana Downs",
      "Mountaineer", "Presque Isle", "Prairie Meadows", "Thistledown",
      "Monmouth", "Monmouth Park", "Oaklawn", "Fair Grounds", "Tampa Bay Downs",
      "Golden Gate", "Golden Gate Fields", "Woodbine",
    ];
    const lower = text.toLowerCase();
    for (const v of venues) {
      if (lower.includes(v.toLowerCase())) { course = v; break; }
    }
  }


  // date: "today" / "tomorrow" / starts_at / explicit YYYY-MM-DD (Europe/London)
  let date: string | null = null;
  const lower = text.toLowerCase();
  const now = new Date();
  if (/\btomorrow\b/.test(lower)) {
    date = londonDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  } else if (/\btoday\b/.test(lower)) {
    date = londonDate(now);
  } else if (hints.starts_at) {
    date = hints.starts_at.slice(0, 10);
  } else {
    date = londonDate(now);
  }

  // race number: "race 5", "5th race", "race no 5", "race #5"
  let raceNumber: number | null = null;
  const rnMatch =
    text.match(/\brace\s*#?\s*(\d{1,2})\b/i) ??
    text.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+race\b/i);
  if (rnMatch) {
    const n = parseInt(rnMatch[1], 10);
    if (n >= 1 && n <= 20) raceNumber = n;
  }

  return { course, time, date, raceNumber };
}


// ---------- API fetch ----------

interface RawRacecardsResponse {
  racecards?: RawRacecard[];
}
interface RawRacecard {
  race_id?: string;
  course?: string;
  region?: string;
  off_time?: string; // "14:20"
  off_dt?: string;
  race_name?: string;
  race_class?: string;
  field_size?: string | number;
  distance?: string;
  going?: string;
  betting_forecast?: string;
  runners?: RawRunner[];
}
interface RawRunner {
  horse?: string;
  jockey?: string;
  trainer?: string;
  number?: string | number;
  draw?: string | number;
  age?: string | number;
  sex?: string;
  lbs?: string | number;
  ofr?: string | number;
  odds?: Array<{ bookmaker?: string; fractional?: string; decimal?: number | string }>;
}

async function fetchRacecards(
  username: string,
  password: string,
  day: "today" | "tomorrow",
): Promise<RawRacecard[] | null> {
  const auth = "Basic " + btoa(`${username}:${password}`);
  // Standard plan: /v1/racecards/standard accepts ?day=today|tomorrow only.
  // Pro plan (which we don't have) is required for arbitrary ?date=.
  const url = `${RACING_API_BASE}/v1/racecards/standard?day=${day}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RACING_API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[racingApi] non-2xx: ${res.status} for day=${day}`);
      return null;
    }
    const data = await res.json() as RawRacecardsResponse;
    return Array.isArray(data.racecards) ? data.racecards : [];
  } catch (e) {
    console.warn(`[racingApi] fetch error: ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- matching ----------

function matchRace(
  cards: RawRacecard[],
  course: string,
  time: string | null,
): RacingRace | null {
  const courseLower = course.toLowerCase().replace(/\s+park\b/, "").trim();

  // candidates: meeting course matches (fuzzy)
  const candidates = cards.filter((c) => {
    const cc = (c.course ?? "").toLowerCase().replace(/\s+park\b/, "").trim();
    if (!cc) return false;
    return cc === courseLower || cc.includes(courseLower) || courseLower.includes(cc);
  });

  if (candidates.length === 0) return null;

  let chosen: RawRacecard | null = null;
  if (time) {
    chosen = candidates.find((c) => raceLocalTime(c) === time) ?? null;
  }
  if (!chosen && candidates.length === 1) chosen = candidates[0];
  if (!chosen) return null;

  return {
    race_id: chosen.race_id ?? null,
    course: chosen.course ?? course,
    region: chosen.region ?? null,
    off_time: chosen.off_time ?? null,
    off_dt: chosen.off_dt ?? null,
    race_name: chosen.race_name ?? null,
    race_class: chosen.race_class ?? null,
    field_size: chosen.field_size !== undefined && chosen.field_size !== null
      ? String(chosen.field_size) : null,
    distance: chosen.distance ?? null,
    going: chosen.going ?? null,
    betting_forecast: chosen.betting_forecast ?? null,
    runners: (chosen.runners ?? []).map(normaliseRunner),
  };
}

/**
 * Authoritative local race time as HH:MM (24h) in Europe/London.
 * Prefers off_dt (full ISO with TZ) — the feed's off_time is 12-hour
 * without am/pm so unsafe to compare raw. Falls back to off_time with
 * the same PM heuristic the user-input parser uses (1–11 → +12) only
 * when off_dt is missing.
 */
function raceLocalTime(c: RawRacecard): string | null {
  if (c.off_dt) {
    const d = new Date(c.off_dt);
    if (!isNaN(d.getTime())) {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(d);
      const hh = parts.find((p) => p.type === "hour")?.value;
      const mm = parts.find((p) => p.type === "minute")?.value;
      if (hh && mm) return `${hh === "24" ? "00" : hh}:${mm}`;
    }
  }
  return normaliseTime(c.off_time);
}

function normaliseTime(t: string | undefined): string | null {
  if (!t) return null;
  const m = t.match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mins = m[2];
  // PM heuristic mirroring parseRacingHints: bare 1–11 on a racing card = PM.
  if (h >= 1 && h <= 11) h += 12;
  return `${String(h).padStart(2, "0")}:${mins}`;
}

function normaliseRunner(r: RawRunner): RacingRunner {
  const str = (v: unknown) =>
    v !== undefined && v !== null && String(v).length > 0 ? String(v) : null;
  return {
    horse: String(r.horse ?? "").trim(),
    jockey: str(r.jockey),
    trainer: str(r.trainer),
    number: str(r.number),
    draw: str(r.draw),
    age: str(r.age),
    sex: str(r.sex),
    lbs: str(r.lbs),
    ofr: str(r.ofr),
    odds: Array.isArray(r.odds) && r.odds.length > 0
      ? r.odds.map((o) => ({
          bookmaker: String(o.bookmaker ?? ""),
          fractional: o.fractional ?? null,
          decimal: typeof o.decimal === "number"
            ? o.decimal
            : (o.decimal ? Number(o.decimal) : null),
        }))
      : null,
  };
}

// ============================================================
// North America (USA + Canada) — advanced add-on
// ============================================================
//
// Two-step fetch: /v1/north-america/meets?start_date&end_date then
// /v1/north-america/meets/{meet_id}/entries. Output is normalised into the
// exact RacingSnapshot shape the UK/IRE path produces so downstream trust
// classification + extractRacingRunners work unchanged.

const US_TRACKS: string[] = [
  "churchill downs", "belmont", "belmont park", "saratoga", "santa anita",
  "del mar", "gulfstream", "gulfstream park", "keeneland", "aqueduct",
  "pimlico", "parx", "parx racing", "finger lakes", "louisiana downs",
  "mountaineer", "presque isle", "prairie meadows", "thistledown",
  "monmouth", "monmouth park", "oaklawn", "fair grounds", "tampa bay downs",
  "golden gate", "golden gate fields", "woodbine",
];

function isNorthAmericanTrack(course: string): boolean {
  const c = course.toLowerCase().trim();
  return US_TRACKS.some((t) => c === t || c.includes(t) || t.includes(c));
}

interface RawMeet {
  meet_id?: string;
  track_id?: string;
  track_name?: string;
  country?: string;
  date?: string;
}
interface RawMeetsResponse { meets?: RawMeet[] }

interface RawNARace {
  race_name?: string;
  race_key?:
    | string
    | number
    | { race_number?: string | number; day_evening?: string };
  race_number?: string | number;
  post_time?: string | null;
  post_time_long?: string | number | null;
  time_zone?: string;
  race_class?: string;
  grade?: string;
  surface_description?: string;
  distance_description?: string;
  purse?: string | number;
  runners?: RawNARunner[];
}

interface RawNARunner {
  horse_name?: string;
  jockey?: string | { first_name?: string; last_name?: string; alias?: string };
  trainer?: string | { first_name?: string; last_name?: string; alias?: string };
  morning_line_odds?: string | null;
  live_odds?: string | null;
  post_pos?: string | number | null;
  program_number?: string | number | null;
  weight?: string | number | null;
  medication?: string | null;
  equipment?: string | null;
}
interface RawEntriesResponse {
  meet_id?: string;
  track_name?: string;
  country?: string;
  date?: string;
  races?: RawNARace[];
}

async function fetchNorthAmericaContext(
  username: string,
  password: string,
  parsed: ParsedHints,
): Promise<RacingSnapshot> {
  const course = parsed.course!;
  const date = parsed.date!;
  // Window: the parsed date itself; if it is today, extend +2 days to absorb
  // late-loading fixtures. Keeps fetch small.
  const start = date;
  const end = addDaysISO(date, 2);
  const meets = await fetchMeets(username, password, start, end);
  if (!meets) return emptySnapshot("NA meets fetch failed");
  if (meets.length === 0) {
    return emptySnapshot(`no NA meets in ${start}..${end}`);
  }

  const meet = matchMeet(meets, course, date);
  if (!meet || !meet.meet_id) {
    return emptySnapshot(`no NA meet matched for ${course} on ${date}`);
  }

  const entries = await fetchEntries(username, password, meet.meet_id);
  if (!entries || !Array.isArray(entries.races) || entries.races.length === 0) {
    return emptySnapshot("NA entries fetch failed or empty");
  }

  const race = matchNARace(entries.races, parsed.time, parsed.raceNumber);
  if (!race) {
    const hint = parsed.raceNumber
      ? `race ${parsed.raceNumber}`
      : (parsed.time ?? "");
    return emptySnapshot(
      `no NA race matched for ${course}${hint ? ` ${hint}` : ""}`,
    );
  }
  const runners = (race.runners ?? []).map(normaliseNARunner);
  if (runners.length === 0) {
    return emptySnapshot("matched NA race has no runners published yet");
  }

  const trackName = entries.track_name ?? meet.track_name ?? course;
  const localTime = derivedNALocalTime(race);
  const offTime = localTime ?? normalisePostTime(race.post_time);
  const offDt = derivedNAIsoTime(race);
  const raceNum = extractNARaceNumber(race);
  return {
    race: {
      race_id: raceNum !== null ? String(raceNum) : null,
      course: trackName,
      region: entries.country ?? meet.country ?? null,
      off_time: offTime,
      off_dt: offDt,
      race_name: race.race_name ?? (raceNum !== null ? `Race ${raceNum}` : null),
      race_class: race.race_class ?? race.grade ?? null,
      field_size: String(runners.length),
      distance: race.distance_description ?? null,
      going: race.surface_description ?? null,
      betting_forecast: null,
      runners,
    },
    runners,
    matched: `${trackName}${offTime ? ` ${offTime}` : raceNum !== null ? ` race ${raceNum}` : ""}`,
    note: `matched ${runners.length} NA runners`,
  };
}


async function fetchMeets(
  username: string,
  password: string,
  start: string,
  end: string,
): Promise<RawMeet[] | null> {
  const auth = "Basic " + btoa(`${username}:${password}`);
  const url = `${RACING_API_BASE}/v1/north-america/meets?start_date=${start}&end_date=${end}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RACING_API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[racingApi] NA meets non-2xx: ${res.status}`);
      return null;
    }
    const data = await res.json() as RawMeetsResponse;
    return Array.isArray(data.meets) ? data.meets : [];
  } catch (e) {
    console.warn(`[racingApi] NA meets error: ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEntries(
  username: string,
  password: string,
  meetId: string,
): Promise<RawEntriesResponse | null> {
  const auth = "Basic " + btoa(`${username}:${password}`);
  const url = `${RACING_API_BASE}/v1/north-america/meets/${encodeURIComponent(meetId)}/entries`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RACING_API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[racingApi] NA entries non-2xx: ${res.status}`);
      return null;
    }
    return await res.json() as RawEntriesResponse;
  } catch (e) {
    console.warn(`[racingApi] NA entries error: ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function matchMeet(
  meets: RawMeet[],
  course: string,
  date: string,
): RawMeet | null {
  const target = course.toLowerCase().trim();
  const sameDate = meets.filter((m) => (m.date ?? "").slice(0, 10) === date);
  const pool = sameDate.length > 0 ? sameDate : meets;
  // exact / contains-either-way fuzzy match
  let best: RawMeet | null = null;
  let bestScore = -1;
  for (const m of pool) {
    const tn = (m.track_name ?? "").toLowerCase().trim();
    if (!tn) continue;
    let score = -1;
    if (tn === target) score = 100;
    else if (tn.includes(target)) score = 80;
    else if (target.includes(tn)) score = 70;
    if (score > bestScore) { best = m; bestScore = score; }
  }
  return best;
}

function matchNARace(
  races: RawNARace[],
  time: string | null,
  raceNumber: number | null,
): RawNARace | null {
  if (races.length === 0) return null;

  // 1. Explicit race-number match wins (US users typically ask "race 5 at Parx").
  if (raceNumber !== null) {
    const byNum = races.find((r) => extractNARaceNumber(r) === raceNumber);
    if (byNum) return byNum;
    // If a race number was asked for but we cannot find it, decline rather
    // than fall through to time-matching guesswork.
    return null;
  }

  if (!time) {
    // No user-specified time and no race number: if only one race, return it;
    // otherwise decline rather than guess.
    return races.length === 1 ? races[0] : null;
  }

  // 2. Time match. Prefer derived track-local time from post_time_long
  // (post_time itself is null on the NA feed); fall back to normalisePostTime.
  const targetMinutes = parseHHMMToMinutes(time);
  let best: RawNARace | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const r of races) {
    const pt = derivedNALocalTime(r) ?? normalisePostTime(r.post_time);
    if (!pt) continue;
    if (pt === time) return r;
    if (targetMinutes !== null) {
      const m = parseHHMMToMinutes(pt);
      if (m === null) continue;
      const d = Math.abs(m - targetMinutes);
      if (d < bestDelta) { best = r; bestDelta = d; }
    }
  }
  // Accept nearest only if within 30 minutes; otherwise decline.
  return bestDelta <= 30 ? best : null;
}

function extractNARaceNumber(r: RawNARace): number | null {
  const candidates: Array<string | number | undefined> = [];
  if (r.race_key && typeof r.race_key === "object") {
    candidates.push(r.race_key.race_number);
  } else if (typeof r.race_key === "string" || typeof r.race_key === "number") {
    candidates.push(r.race_key);
  }
  candidates.push(r.race_number);
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    const n = parseInt(String(c), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Map the feed's short timezone code (E/C/M/P) to an IANA zone. */
function naIanaZone(code: string | undefined | null): string {
  switch ((code ?? "").trim().toUpperCase()) {
    case "E": return "America/New_York";
    case "C": return "America/Chicago";
    case "M": return "America/Denver";
    case "P": return "America/Los_Angeles";
    default: return "America/New_York";
  }
}

/** Derive HH:MM (24h) track-local from post_time_long (epoch ms). */
function derivedNALocalTime(r: RawNARace): string | null {
  const epoch = parseEpochMs(r.post_time_long);
  if (epoch === null) return null;
  const d = new Date(epoch);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: naIanaZone(r.time_zone),
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const hh = parts.find((p) => p.type === "hour")?.value;
  const mm = parts.find((p) => p.type === "minute")?.value;
  if (!hh || !mm) return null;
  return `${hh === "24" ? "00" : hh}:${mm}`;
}

function derivedNAIsoTime(r: RawNARace): string | null {
  const epoch = parseEpochMs(r.post_time_long);
  if (epoch === null) return null;
  const d = new Date(epoch);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function parseEpochMs(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}


function parseHHMMToMinutes(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Normalise NA post_time (e.g. "1:35 PM", "13:35") to HH:MM 24h, track-local. */
function normalisePostTime(t: string | undefined | null): string | null {
  if (!t) return null;
  const m = t.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mins = m[2];
  const ap = (m[3] ?? "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  else if (ap === "am" && h === 12) h = 0;
  if (h < 0 || h > 23) return null;
  return `${String(h).padStart(2, "0")}:${mins}`;
}

function normaliseNARunner(r: RawNARunner): RacingRunner {
  const decimal = parseUSOddsToDecimal(r.live_odds) ?? parseUSOddsToDecimal(r.morning_line_odds);
  const str = (v: unknown) =>
    v !== undefined && v !== null && String(v).length > 0 ? String(v) : null;
  return {
    horse: String(r.horse_name ?? "").trim(),
    jockey: extractPersonName(r.jockey),
    trainer: extractPersonName(r.trainer),
    number: str(r.program_number),
    draw: str(r.post_pos),
    age: null,
    sex: null,
    lbs: str(r.weight),
    ofr: null,
    odds: decimal !== null
      ? [{
          bookmaker: r.live_odds ? "live" : "morning_line",
          fractional: r.live_odds ?? r.morning_line_odds ?? null,
          decimal,
        }]
      : null,
  };
}

function extractPersonName(
  v: string | { first_name?: string; last_name?: string; alias?: string } | undefined | null,
): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.trim() || null;
  if (v.alias && v.alias.trim()) return v.alias.trim();
  const combined = [v.first_name, v.last_name].filter(Boolean).join(" ").trim();
  return combined || null;
}

/** Parse US dash-fractional odds ("7-2") or plain fractions ("7/2") to decimal. */
function parseUSOddsToDecimal(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*[-/]\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (den > 0 && Number.isFinite(num) && Number.isFinite(den)) {
      return num / den + 1;
    }
  }
  // bare decimal fallback
  const n = Number(s);
  if (Number.isFinite(n) && n > 1) return n;
  return null;
}

function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
