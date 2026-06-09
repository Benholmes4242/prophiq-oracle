// Sport grounding — one shared module that produces feed-backed structured
// grounding for a sport event, used by BOTH submit-question (typed flow)
// and generate-prediction / sport.ts gatherStructuredSources (cron flow).
//
// Background: today the two paths diverge.
//   - submit-question runs the resolver, then calls the NEW confirm helpers
//     (confirmFootballMatch / confirmFootballLeague, findGolfMatches,
//     fetchRacePicker) to arm structured outcomes + metadata before the
//     forecast pipeline.
//   - the cron has no user / no resolver, so it never runs the confirm
//     helpers. It only fetches whatever sport.ts gatherStructuredSources
//     gives it (footballData / racingApi / sportRadarGolf context fetchers
//     keyed off event hints) and rewrites racing/golf outcomes post-hoc in
//     generate-prediction via extractRacingRunners.
//
// This module is the convergence point. Given a sport kind + canonical
// event string (+ optional approx date / competitors), it routes to the
// right confirm helper and returns a UNIFORM shape both callers consume.
//
// Migration is incremental:
//   step 1 (this file) — wrapper exists; no call sites changed.
//   step 2 — submit-question's three inline sport branches call
//            groundSportEvent (behaviour-preserving; same helpers underneath).
//   step 3 — sport.ts gatherStructuredSources synthesises canonical event
//            from event.title + event.starts_at and calls groundSportEvent
//            for football/golf/racing; old context fetchers retire for
//            those three. theSportsDB stays as the fallback for non-confirm
//            sports / props.
//   step 4 — generate-prediction drops the racing outcome-rewrite block;
//            the cron's groundSportEvent result now carries those outcomes.
//
// NEVER throws. On any internal failure returns { kind: "none", ... } and
// the caller falls through to its existing research_grounded path.

import {
  confirmFootballMatch,
  confirmFootballLeague,
  classifyFootballEvent,
  type FootballMatchCandidate,
} from "./footballConfirm.ts";
import {
  findGolfMatches,
  fetchGolfContext,
  type GolfMatch,
  type GolfSnapshot,
} from "./sportRadarGolf.ts";
import {
  fetchRacePicker,
  fetchRacingContext,
  type RacingRace,
  type RacingRunner,
  type RacingSnapshot,
} from "./racingApi.ts";
import {
  confirmTennisMatch,
  type TennisMatchCandidate,
} from "./tennisConfirm.ts";

/** Sport kinds with a wired confirm path. "other" falls through. */
export type SportKind =
  | "football"
  | "golf"
  | "horse_racing"
  | "tennis"
  | "other";

export interface SportGroundingInput {
  sport: SportKind;
  /** Clean canonical event string (e.g. "Arsenal vs Chelsea", "Carlisle 16:18 today"). */
  canonicalEvent: string;
  /** ISO YYYY-MM-DD when known; null otherwise. */
  approxDate: string | null;
  /** Named competitors when known (e.g. football [home, away]); empty/null otherwise. */
  competitors: string[] | null;
}

/**
 * Uniform grounding result. Callers branch on `kind`:
 *   - "confirmed" : single match / race / tournament locked in. Use
 *                   `outcomes` to seed event_outcomes, `metadata` to
 *                   thread onto event.metadata (e.g. football_confirm),
 *                   `starts_at`/`resolves_at` to override schedule.
 *   - "picker"    : multiple candidates; submit-question emits a picker
 *                   SSE and stops. Cron treats this as "no confirm" and
 *                   falls through to research_grounded (the cron has no
 *                   user to disambiguate).
 *   - "league"    : feed-backed league/title field. Use `contenders`
 *                   for outcomes; `metadata.football_confirm` for trust.
 *   - "none"      : no confirm produced. Caller falls through to its
 *                   existing path (typed: research_grounded; cron:
 *                   gatherStructuredSources continues with theSportsDB
 *                   etc., unchanged).
 */
export type SportGroundingResult =
  | {
      kind: "confirmed_match";
      sport: "football";
      outcomes: string[]; // [home, "Draw", away]
      starts_at: string; // kickoff ISO
      metadata: { football_confirm: FootballMatchConfirmMeta };
    }
  | {
      kind: "league";
      sport: "football";
      contenders: string[];
      resolves_at: string;
      metadata: { football_confirm: FootballLeagueConfirmMeta };
    }
  | {
      kind: "picker_football";
      candidates: FootballMatchCandidate[];
    }
  | {
      kind: "golf_match";
      sport: "golf";
      match: GolfMatch;
    }
  | {
      kind: "picker_golf";
      candidates: GolfMatch[];
    }
  | {
      kind: "racing_confirmed";
      sport: "horse_racing";
      /** Favourite-first runner labels (bucketed tail when >8). */
      outcomes: string[];
      runners: RacingRunner[];
      race: RacingRace;
      track_name: string;
      date: string;
    }
  | {
      kind: "picker_racing";
      /** Raw fetchRacePicker payload — submit-question already knows this shape. */
      picker: Awaited<ReturnType<typeof fetchRacePicker>>;
    }
  | {
      kind: "racing_fallthrough";
      /** Dark-day / unmatched / no-runners: caller treats as field-forming
       * (low_data) — research_grounded must NOT surface placeholder horses. */
      picker: Awaited<ReturnType<typeof fetchRacePicker>>;
    }
  | {
      kind: "tennis_match";
      sport: "tennis";
      /** Exactly two real player names from the feed; NO draw, NO bucket. */
      outcomes: [string, string];
      starts_at: string;
      metadata: { tennis_confirm: TennisMatchConfirmMeta };
    }
  | {
      kind: "picker_tennis";
      candidates: TennisMatchCandidate[];
    }
  | { kind: "none"; reason: string };

export interface TennisMatchConfirmMeta {
  kind: "match";
  event_id: string;
  player_a: string;
  player_b: string;
  tournament: string | null;
  starts_at: string;
}

export interface FootballMatchConfirmMeta {
  kind: "match";
  fixture_id: string;
  home_team: string;
  away_team: string;
  kickoff: string;
  competition: string | null;
}

export interface FootballLeagueConfirmMeta {
  kind: "league";
  competition: string;
  league_id: number;
  season: number;
  contenders: string[];
  standings_summary: string;
  resolves_at: string;
}

/**
 * Route a sport event to its confirm helper. Never throws.
 *
 * Callers that don't have credentials / api keys for a given sport will
 * get { kind: "none", reason } from the underlying helper and should
 * fall through to their existing grounding path.
 */
export async function groundSportEvent(
  input: SportGroundingInput,
): Promise<SportGroundingResult> {
  const canonical = (input.canonicalEvent ?? "").trim();
  if (!canonical) return { kind: "none", reason: "empty canonical_event" };

  try {
    switch (input.sport) {
      case "football":
        return await groundFootball(input);
      case "golf":
        return await groundGolf(input);
      case "horse_racing":
        return await groundRacing(input);
      case "tennis":
        return await groundTennis(input);
      case "other":
      default:
        return { kind: "none", reason: "sport not wired for confirm" };
    }
  } catch (e) {
    return { kind: "none", reason: `grounding threw: ${(e as Error).message}` };
  }
}

async function groundFootball(
  input: SportGroundingInput,
): Promise<SportGroundingResult> {
  const shape = classifyFootballEvent(input.canonicalEvent, input.competitors);
  if (shape === "neither") {
    return { kind: "none", reason: "football canonical_event is neither match nor league" };
  }

  if (shape === "match") {
    const confirm = await confirmFootballMatch(
      input.canonicalEvent,
      input.approxDate,
      input.competitors,
    );
    if (confirm.kind === "none") {
      return { kind: "none", reason: `football match confirm: ${confirm.reason}` };
    }
    if (confirm.kind === "multiple") {
      return { kind: "picker_football", candidates: confirm.matches };
    }
    // single
    const m = confirm.match;
    return {
      kind: "confirmed_match",
      sport: "football",
      outcomes: [m.home_team, "Draw", m.away_team],
      starts_at: m.kickoff,
      metadata: {
        football_confirm: {
          kind: "match",
          fixture_id: m.fixture_id,
          home_team: m.home_team,
          away_team: m.away_team,
          kickoff: m.kickoff,
          competition: m.competition || null,
        },
      },
    };
  }

  // league
  const confirm = await confirmFootballLeague(input.canonicalEvent);
  if (confirm.kind === "none" || !confirm.contenders || confirm.contenders.length === 0) {
    return { kind: "none", reason: `football league confirm: ${confirm.reason ?? "no contenders"}` };
  }
  const top = confirm.contenders.slice(0, 6);
  const summary = (confirm.standings ?? [])
    .slice(0, 10)
    .map((s) =>
      `${s.rank}. ${s.team_name} - ${s.points}pts (${s.played} pl, GD ${s.goal_diff >= 0 ? "+" : ""}${s.goal_diff}, form ${s.form ?? "-"})`,
    )
    .join("\n");
  return {
    kind: "league",
    sport: "football",
    contenders: top,
    resolves_at: confirm.resolves_at!,
    metadata: {
      football_confirm: {
        kind: "league",
        competition: confirm.competition ?? input.canonicalEvent,
        league_id: confirm.league_id!,
        season: confirm.season!,
        contenders: top,
        standings_summary: summary,
        resolves_at: confirm.resolves_at!,
      },
    },
  };
}

async function groundGolf(
  input: SportGroundingInput,
): Promise<SportGroundingResult> {
  const apiKey = readEnv("SPORTRADAR_GOLF_API_KEY");
  if (!apiKey) return { kind: "none", reason: "SPORTRADAR_GOLF_API_KEY missing" };

  const { matches } = await findGolfMatches(apiKey, {
    title: input.canonicalEvent,
    question: input.canonicalEvent,
    starts_at: input.approxDate
      ? new Date(`${input.approxDate}T12:00:00Z`).toISOString()
      : new Date().toISOString(),
  });
  if (matches.length === 0) {
    return { kind: "none", reason: "no golf tournament matched" };
  }
  if (matches.length === 1) {
    return { kind: "golf_match", sport: "golf", match: matches[0] };
  }
  return { kind: "picker_golf", candidates: matches };
}

async function groundRacing(
  input: SportGroundingInput,
): Promise<SportGroundingResult> {
  const u = readEnv("RACING_API_USERNAME");
  const p = readEnv("RACING_API_PASSWORD");
  if (!u || !p) return { kind: "none", reason: "RACING_API creds missing" };

  const picker = await fetchRacePicker(u, p, {
    title: input.canonicalEvent,
    question: input.canonicalEvent,
    starts_at: input.approxDate
      ? new Date(`${input.approxDate}T12:00:00Z`).toISOString()
      : new Date().toISOString(),
  });
  // Single race fully specified by course+time/race_number → emit a
  // dedicated racing_confirmed result so both call sites can treat it
  // as feed_backed without a second feed hit.
  if (picker.kind === "race") {
    const outcomes = favouriteFirstRunnerLabels(picker.runners);
    return {
      kind: "racing_confirmed",
      sport: "horse_racing",
      outcomes,
      runners: picker.runners,
      race: picker.race,
      track_name: picker.track_name,
      date: picker.date,
    };
  }
  if (picker.kind === "races" && picker.races.length >= 2) {
    return { kind: "picker_racing", picker };
  }
  // dark_day / unmatched / 1-entry races picker (runners not published)
  return { kind: "racing_fallthrough", picker };
}

async function groundTennis(
  input: SportGroundingInput,
): Promise<SportGroundingResult> {
  // TheSportsDB free public key "3" works for tennis. No env-key gate.
  const confirm = await confirmTennisMatch(input.canonicalEvent, input.approxDate);
  if (confirm.kind === "none") {
    return { kind: "none", reason: `tennis confirm: ${confirm.reason}` };
  }
  if (confirm.kind === "multiple") {
    return { kind: "picker_tennis", candidates: confirm.matches };
  }
  const m = confirm.match;
  if (!m.player_a || !m.player_b) {
    return { kind: "none", reason: "tennis confirm returned an empty player" };
  }
  return {
    kind: "tennis_match",
    sport: "tennis",
    outcomes: [m.player_a, m.player_b],
    starts_at: m.starts_at,
    metadata: {
      tennis_confirm: {
        kind: "match",
        event_id: m.event_id,
        player_a: m.player_a,
        player_b: m.player_b,
        tournament: m.tournament,
        starts_at: m.starts_at,
      },
    },
  };
}

/** Favourite-first runner labels (best decimal price first; unpriced last).
 * Bucketed tail "Any other runner" when field > 8. Mirrors the bucketing
 * used by sport.ts gatherStructuredSources for the cron grounding path. */
function favouriteFirstRunnerLabels(runners: RacingRunner[]): string[] {
  const named = runners
    .map((r) => {
      const horse = String(r.horse ?? "").trim();
      if (!horse) return null;
      const decs: number[] = [];
      for (const o of r.odds ?? []) {
        const v = typeof o.decimal === "number" ? o.decimal : Number(o.decimal);
        if (Number.isFinite(v) && v > 0) decs.push(v);
      }
      return { horse, best: decs.length > 0 ? Math.min(...decs) : null };
    })
    .filter((r): r is { horse: string; best: number | null } => r !== null);
  const priced = named.filter((r) => r.best !== null).sort((a, b) => (a.best! - b.best!));
  const unpriced = named.filter((r) => r.best === null);
  const all = [...priced, ...unpriced].map((r) => r.horse);
  const MAX = 8;
  if (all.length <= MAX) return all;
  return [...all.slice(0, MAX), "Any other runner"];
}

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

// ============================================================
// Cron wrapper — converges feed-backed grounding for sport.ts
// gatherStructuredSources. Produces:
//   - sources: pre-shaped StructuredDataSource-like entries
//              named with the SAME source names existing code
//              (extractRacingRunners, isGolfRunnersSource) already
//              recognises — "footballConfirm", "racingApi",
//              "sportRadarGolf" — so the downstream rewrite logic
//              works unchanged.
//   - outcomes: when grounding produced a real field of named
//               entities (teams / runners / players), the list of
//               labels in favourite-first order; null otherwise.
//   - isGolf: lets the caller pick the right bucket label
//             ("Any other player" vs "Any other runner") when
//             truncating long fields.
// Never throws — internal failures degrade to {sources:[],outcomes:null}.
// ============================================================

export interface CronGroundingSource {
  name: string;
  data: unknown;
  fetched_at: string;
  duration_ms: number;
}

export interface CronGroundingResult {
  sources: CronGroundingSource[];
  outcomes: string[] | null;
  isGolf: boolean;
}

export async function groundSportEventForCron(
  input: SportGroundingInput,
): Promise<CronGroundingResult> {
  const t0 = Date.now();
  try {
    const result = await groundSportEvent(input);
    switch (result.kind) {
      case "confirmed_match":
        return {
          sources: [
            {
              name: "footballConfirm",
              data: { matched: result.metadata.football_confirm },
              fetched_at: new Date().toISOString(),
              duration_ms: Date.now() - t0,
            },
          ],
          outcomes: result.outcomes,
          isGolf: false,
        };
      case "league":
        return {
          sources: [
            {
              name: "footballConfirm",
              data: { matched: result.metadata.football_confirm },
              fetched_at: new Date().toISOString(),
              duration_ms: Date.now() - t0,
            },
          ],
          outcomes: result.contenders,
          isGolf: false,
        };
      case "golf_match": {
        const snap = await fetchGolfRunners(input, result.match);
        const outcomes = extractRunnerLabels(snap);
        return {
          sources: snap
            ? [
                {
                  name: "sportRadarGolf",
                  data: snap,
                  fetched_at: new Date().toISOString(),
                  duration_ms: Date.now() - t0,
                },
              ]
            : [],
          outcomes,
          isGolf: true,
        };
      }
      case "racing_confirmed": {
        // Feed-backed race + runners already in hand — emit a racingApi
        // source so extractRacingRunners + isGolfRunnersSource (in
        // forecastContext.ts) recognise it unchanged and downstream
        // tiering goes straight to feed_backed.
        const snap: RacingSnapshot = {
          race: result.race,
          runners: result.runners,
          matched: `${result.race.course}${result.race.off_time ? ` ${result.race.off_time}` : ""}`,
          note: `racing_confirmed ${result.runners.length} runners`,
        };
        return {
          sources: [
            {
              name: "racingApi",
              data: snap,
              fetched_at: new Date().toISOString(),
              duration_ms: Date.now() - t0,
            },
          ],
          outcomes: result.outcomes,
          isGolf: false,
        };
      }
      case "racing_fallthrough": {
        // Dark day / unmatched / runners not yet published — try a last-
        // resort context fetch (parses fresh hints from canonicalEvent).
        // If that also returns no runners, emit no sources so the trust
        // layer falls through to the low_data field-forming guard rather
        // than research_grounded placeholder horses.
        const snap = await fetchRacingRunners(input);
        const outcomes = extractRunnerLabels(snap);
        return {
          sources: snap && snap.runners.length > 0
            ? [
                {
                  name: "racingApi",
                  data: snap,
                  fetched_at: new Date().toISOString(),
                  duration_ms: Date.now() - t0,
                },
              ]
            : [],
          outcomes,
          isGolf: false,
        };
      }
      case "tennis_match":
        return {
          sources: [
            {
              name: "tennisConfirm",
              data: { matched: result.metadata.tennis_confirm },
              fetched_at: new Date().toISOString(),
              duration_ms: Date.now() - t0,
            },
          ],
          outcomes: [result.outcomes[0], result.outcomes[1]],
          isGolf: false,
        };
      case "picker_football":
      case "picker_golf":
      case "picker_racing":
      case "picker_tennis":
        // Cron has no user to disambiguate — fall through to research_grounded.
        return { sources: [], outcomes: null, isGolf: false };
      case "none":
      default:
        return { sources: [], outcomes: null, isGolf: false };
    }
  } catch (e) {
    console.warn(`[sportGrounding] cron wrapper threw: ${(e as Error).message}`);
    return { sources: [], outcomes: null, isGolf: false };
  }
}

async function fetchGolfRunners(
  input: SportGroundingInput,
  match: GolfMatch,
): Promise<GolfSnapshot | null> {
  const apiKey = readEnv("SPORTRADAR_GOLF_API_KEY");
  if (!apiKey) return null;
  try {
    return await fetchGolfContext(apiKey, {
      metadata: {
        golf_tour_alias: match.tour,
        golf_tournament_id: match.tournament_id,
        golf_tournament_name: match.tournament_name,
      },
      title: input.canonicalEvent,
      question: input.canonicalEvent,
      starts_at: input.approxDate
        ? new Date(`${input.approxDate}T12:00:00Z`).toISOString()
        : new Date().toISOString(),
    });
  } catch {
    return null;
  }
}

async function fetchRacingRunners(
  input: SportGroundingInput,
): Promise<RacingSnapshot | null> {
  const u = readEnv("RACING_API_USERNAME");
  const p = readEnv("RACING_API_PASSWORD");
  if (!u || !p) return null;
  try {
    return await fetchRacingContext(u, p, {
      title: input.canonicalEvent,
      question: input.canonicalEvent,
      starts_at: input.approxDate
        ? new Date(`${input.approxDate}T12:00:00Z`).toISOString()
        : new Date().toISOString(),
      metadata: null,
    });
  } catch {
    return null;
  }
}

function extractRunnerLabels(
  snap: { runners?: Array<{ horse?: string }> } | null,
): string[] | null {
  if (!snap || !Array.isArray(snap.runners) || snap.runners.length === 0) return null;
  const labels: string[] = [];
  for (const r of snap.runners) {
    const h = String(r.horse ?? "").trim();
    if (h) labels.push(h);
  }
  return labels.length > 0 ? labels : null;
}
