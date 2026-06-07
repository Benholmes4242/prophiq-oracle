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
      "Churchill Downs", "Belmont", "Saratoga", "Santa Anita", "Del Mar",
      "Gulfstream", "Keeneland", "Aqueduct", "Pimlico",
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

  return { course, time, date };
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

function normaliseTime(t: string | undefined): string | null {
  if (!t) return null;
  const m = t.match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  return `${String(parseInt(m[1], 10)).padStart(2, "0")}:${m[2]}`;
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
