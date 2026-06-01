// Canonical public origin for this deployment. Reads PUBLIC_BASE_URL at
// runtime (server) or VITE_PUBLIC_URL at build time (client). Falls back
// to the Lovable preview URL when neither is set.
//
// At DNS flip time, set both env vars to https://prophiq.io and every
// OG card / sitemap entry / robots.txt sitemap directive updates with
// no code change required.

const FALLBACK = "https://prophiq-opinion-nexus.lovable.app";

export function getPublicBaseUrl(): string {
  if (typeof process !== "undefined" && process.env?.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  }
  const v = (import.meta as { env?: Record<string, string> }).env
    ?.VITE_PUBLIC_URL;
  if (v) return v.replace(/\/$/, "");
  return FALLBACK;
}
