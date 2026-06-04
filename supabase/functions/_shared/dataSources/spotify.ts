// Spotify Web API adapter. Client-credentials flow.
// Docs: https://developer.spotify.com/documentation/web-api/concepts/authorization
//
// Brief GG: best-effort context for album/single releases, chart debuts,
// artist momentum. The client-credentials access token is cached in
// module-level memory across function invocations (Deno worker reuse).
// Strategy:
//   1. Get bearer token (cached until ~60s before expiry)
//   2. /v1/search?type=album,track,artist&q=<query>
//   3. Return top hits with popularity scores

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_TIMEOUT_MS = 10_000;

interface CachedToken {
  access_token: string;
  expires_at: number; // epoch ms
}

let cachedToken: CachedToken | null = null;

export interface SpotifyArtistLite {
  id: string;
  name: string;
  popularity: number | null;
  followers: number | null;
  genres: string[];
}

export interface SpotifyAlbumLite {
  id: string;
  name: string;
  artists: string[];
  release_date: string | null;
  total_tracks: number | null;
  album_type: string | null;
}

export interface SpotifyTrackLite {
  id: string;
  name: string;
  artists: string[];
  popularity: number | null;
  album: string | null;
  release_date: string | null;
}

export interface SpotifySnapshot {
  query: string;
  artists: SpotifyArtistLite[];
  albums: SpotifyAlbumLite[];
  tracks: SpotifyTrackLite[];
  note?: string;
}

interface SpotifyHints {
  metadata?: Record<string, unknown> | null;
  title?: string;
  question?: string;
  starts_at?: string;
}

export async function fetchSpotifyContext(
  clientId: string,
  clientSecret: string,
  hints: SpotifyHints,
): Promise<SpotifySnapshot> {
  if (!clientId || !clientSecret) {
    return { query: "", artists: [], albums: [], tracks: [], note: "Spotify credentials missing" };
  }

  const query = buildSearchQuery(hints);
  if (!query) {
    return { query: "", artists: [], albums: [], tracks: [], note: "no usable query from event" };
  }

  const token = await getAccessToken(clientId, clientSecret);
  if (!token) {
    return { query, artists: [], albums: [], tracks: [], note: "Spotify auth failed" };
  }

  const url = `${SPOTIFY_API_BASE}/search?type=album,track,artist&limit=5&q=${encodeURIComponent(query)}`;
  const data = await spotifyFetch<SpotifySearchResponse>(token, url);
  if (!data) {
    return { query, artists: [], albums: [], tracks: [], note: "Spotify search failed" };
  }

  return {
    query,
    artists: (data.artists?.items ?? []).map(normaliseArtist),
    albums: (data.albums?.items ?? []).map(normaliseAlbum),
    tracks: (data.tracks?.items ?? []).map(normaliseTrack),
  };
}

async function getAccessToken(clientId: string, clientSecret: string): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && cachedToken.expires_at > now + 60_000) {
    return cachedToken.access_token;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SPOTIFY_TIMEOUT_MS);
  try {
    const basic = btoa(`${clientId}:${clientSecret}`);
    const res = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[spotify] token fetch failed: ${res.status}`);
      return null;
    }
    const data = await res.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token || typeof data.expires_in !== "number") return null;
    cachedToken = {
      access_token: data.access_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };
    return cachedToken.access_token;
  } catch (err) {
    console.warn(`[spotify] token fetch threw: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function spotifyFetch<T>(token: string, url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SPOTIFY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSearchQuery(hints: SpotifyHints): string {
  const title = hints.title ?? "";
  const cleaned = title.split(/[\(\-:]/)[0].trim();
  return cleaned.replace(/\s+/g, " ").trim();
}

interface SpotifySearchResponse {
  artists?: { items: Array<Record<string, unknown>> };
  albums?: { items: Array<Record<string, unknown>> };
  tracks?: { items: Array<Record<string, unknown>> };
}

function normaliseArtist(r: Record<string, unknown>): SpotifyArtistLite {
  const followers = r.followers as { total?: number } | undefined;
  return {
    id: (r.id as string) ?? "",
    name: (r.name as string) ?? "",
    popularity: typeof r.popularity === "number" ? r.popularity : null,
    followers: typeof followers?.total === "number" ? followers.total : null,
    genres: Array.isArray(r.genres) ? (r.genres as string[]) : [],
  };
}

function normaliseAlbum(r: Record<string, unknown>): SpotifyAlbumLite {
  const artists = Array.isArray(r.artists)
    ? (r.artists as Array<{ name?: string }>).map((a) => a.name ?? "").filter(Boolean)
    : [];
  return {
    id: (r.id as string) ?? "",
    name: (r.name as string) ?? "",
    artists,
    release_date: (r.release_date as string | undefined) ?? null,
    total_tracks: typeof r.total_tracks === "number" ? r.total_tracks : null,
    album_type: (r.album_type as string | undefined) ?? null,
  };
}

function normaliseTrack(r: Record<string, unknown>): SpotifyTrackLite {
  const artists = Array.isArray(r.artists)
    ? (r.artists as Array<{ name?: string }>).map((a) => a.name ?? "").filter(Boolean)
    : [];
  const album = r.album as { name?: string; release_date?: string } | undefined;
  return {
    id: (r.id as string) ?? "",
    name: (r.name as string) ?? "",
    artists,
    popularity: typeof r.popularity === "number" ? r.popularity : null,
    album: album?.name ?? null,
    release_date: album?.release_date ?? null,
  };
}
