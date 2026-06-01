// Lightweight, deterministic-per-browser fingerprint. NOT a tracking ID — just
// a stable hash for rate limiting + chat-thread continuity. Computed entirely
// in the browser; SSR returns "" until hydration.
//
// Inputs: navigator.userAgent + screen.width + screen.height + IANA tz.
// Output: 16-char hex prefix of SHA-256.

import { useEffect, useState } from "react";

let cached: string | null = null;

async function computeFingerprint(): Promise<string> {
  if (typeof window === "undefined") return "";
  if (cached) return cached;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "unknown";
  const payload = `${navigator.userAgent}|${screen.width}x${screen.height}|${tz}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  cached = hex.slice(0, 32);
  return cached;
}

export function useBrowserFingerprint(): string {
  const [fp, setFp] = useState<string>(cached ?? "");
  useEffect(() => {
    let active = true;
    computeFingerprint().then((v) => {
      if (active) setFp(v);
    });
    return () => {
      active = false;
    };
  }, []);
  return fp;
}

// Imperative variant for one-off use inside submit handlers.
export async function getBrowserFingerprint(): Promise<string> {
  return computeFingerprint();
}
