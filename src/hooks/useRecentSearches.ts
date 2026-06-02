import { useEffect, useState, useCallback } from "react";

const KEY = "prophiq:recent-searches";
const MAX = 5;

export function useRecentSearches() {
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRecents(parsed.filter((s): s is string => typeof s === "string"));
        }
      }
    } catch {
      /* corrupted localStorage — ignore */
    }
  }, []);

  const persist = useCallback((next: string[]) => {
    setRecents(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* quota exceeded — ignore */
    }
  }, []);

  const add = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setRecents((prev) => {
      const next = [
        trimmed,
        ...prev.filter((r) => r.toLowerCase() !== trimmed.toLowerCase()),
      ].slice(0, MAX);
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const remove = useCallback((query: string) => {
    setRecents((prev) => {
      const next = prev.filter((r) => r !== query);
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    persist([]);
  }, [persist]);

  return { recents, add, remove, clear };
}
