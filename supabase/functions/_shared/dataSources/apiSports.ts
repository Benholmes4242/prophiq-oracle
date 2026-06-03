// API-Sports football adapter. Read-only, requires API key.
// Documentation: https://www.api-football.com/documentation-v3
//
// Free tier: 100 requests/day. Paid tier ~$20/month for higher volume.
// Set env var API_SPORTS_KEY to enable. If unset, every function returns
// null (graceful degrade - structured data block is omitted from prompts).

const API_SPORTS_BASE = "https://v3.football.api-sports.io";
const API_SPORTS_TIMEOUT_MS = 15_000;
const API_SPORTS_VERSION = "v3";

function getApiKey(): string | null {
  const key = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get("API_SPORTS_KEY");
  return key && key.trim().length > 0 ? key.trim() : null;
}

async function apiSportsFetch<T>(
  path: string,
  params: Record<string, string>,
): Promise<T | null> {
  const key = getApiKey();
  if (!key) return null;

  const url = new URL(`${API_SPORTS_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_SPORTS_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { "x-apisports-key": key, "Accept": "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[apiSports] ${path} failed: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data as T;
  } catch (e) {
    console.warn(`[apiSports] ${path} threw: ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface ApiSportsTeam {
  id: number;
  name: string;
  country: string;
  founded: number | null;
  logo: string | null;
}

export interface ApiSportsFixture {
  fixture_id: number;
  date: string;
  home_team: { id: number; name: string };
  away_team: { id: number; name: string };
  home_goals: number | null;
  away_goals: number | null;
  status: string;
  league_name: string;
}

export interface ApiSportsStanding {
  team_id: number;
  team_name: string;
  rank: number;
  points: number;
  goal_diff: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  form: string;
}

export async function searchTeamByName(name: string): Promise<ApiSportsTeam | null> {
  type Resp = { response: Array<{ team: ApiSportsTeam }> };
  const data = await apiSportsFetch<Resp>("/teams", { search: name });
  if (!data?.response?.[0]?.team) return null;
  return data.response[0].team;
}

export async function getTeamRecentForm(
  teamId: number,
  n = 5,
): Promise<ApiSportsFixture[]> {
  type Resp = {
    response: Array<{
      fixture: { id: number; date: string; status: { short: string } };
      league: { name: string };
      teams: { home: { id: number; name: string }; away: { id: number; name: string } };
      goals: { home: number | null; away: number | null };
    }>;
  };

  const data = await apiSportsFetch<Resp>("/fixtures", {
    team: String(teamId),
    last: String(n),
  });
  if (!data?.response) return [];

  return data.response.map((r) => ({
    fixture_id: r.fixture.id,
    date: r.fixture.date,
    home_team: r.teams.home,
    away_team: r.teams.away,
    home_goals: r.goals.home,
    away_goals: r.goals.away,
    status: r.fixture.status.short,
    league_name: r.league.name,
  }));
}

export async function getHeadToHead(
  teamA: number,
  teamB: number,
  n = 5,
): Promise<ApiSportsFixture[]> {
  type Resp = {
    response: Array<{
      fixture: { id: number; date: string; status: { short: string } };
      league: { name: string };
      teams: { home: { id: number; name: string }; away: { id: number; name: string } };
      goals: { home: number | null; away: number | null };
    }>;
  };

  const data = await apiSportsFetch<Resp>("/fixtures/headtohead", {
    h2h: `${teamA}-${teamB}`,
    last: String(n),
  });
  if (!data?.response) return [];

  return data.response.map((r) => ({
    fixture_id: r.fixture.id,
    date: r.fixture.date,
    home_team: r.teams.home,
    away_team: r.teams.away,
    home_goals: r.goals.home,
    away_goals: r.goals.away,
    status: r.fixture.status.short,
    league_name: r.league.name,
  }));
}

export async function getLeagueStandings(
  leagueId: number,
  season: number,
): Promise<ApiSportsStanding[]> {
  type Resp = {
    response: Array<{
      league: {
        standings: Array<
          Array<{
            rank: number;
            team: { id: number; name: string };
            points: number;
            goalsDiff: number;
            all: { played: number; win: number; draw: number; lose: number };
            form: string;
          }>
        >;
      };
    }>;
  };

  const data = await apiSportsFetch<Resp>("/standings", {
    league: String(leagueId),
    season: String(season),
  });
  const rows = data?.response?.[0]?.league?.standings?.[0];
  if (!rows) return [];

  return rows.map((r) => ({
    team_id: r.team.id,
    team_name: r.team.name,
    rank: r.rank,
    points: r.points,
    goal_diff: r.goalsDiff,
    played: r.all.played,
    wins: r.all.win,
    draws: r.all.draw,
    losses: r.all.lose,
    form: r.form,
  }));
}

export const apiSportsVersionTag = `api-sports-football-${API_SPORTS_VERSION}`;
