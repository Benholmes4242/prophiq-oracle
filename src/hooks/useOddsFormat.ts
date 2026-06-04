// useOddsFormat — resolves the odds format for a given domain. Reads the
// per-user override from localStorage (key `prophiq:odds-format`) and falls
// back to the domain default. The "auto" override means "use domain default".
//
// Brief FF v2 Phase D defaults:
//   sport         → fractional
//   markets       → decimal
//   entertainment → decimal
//   politics      → percent-only (no odds rendered; OddsDisplay returns null)

import { useEffect, useState } from "react";
import type { DomainId } from "@/lib/types";

export type OddsFormat = "decimal" | "fractional" | "american" | "percent-only";
export type OddsFormatOverride = "auto" | OddsFormat;

export const ODDS_FORMAT_STORAGE_KEY = "prophiq:odds-format";

export const DOMAIN_DEFAULT_FORMAT: Record<DomainId, OddsFormat> = {
  sport: "fractional",
  markets: "decimal",
  entertainment: "decimal",
  politics: "percent-only",
};

function readOverride(): OddsFormatOverride {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = window.localStorage.getItem(ODDS_FORMAT_STORAGE_KEY);
    if (raw === "decimal" || raw === "fractional" || raw === "american" || raw === "percent-only") {
      return raw;
    }
  } catch {
    /* localStorage unavailable */
  }
  return "auto";
}

const STORAGE_EVENT = "prophiq:odds-format-changed";

export function setOddsFormatOverride(value: OddsFormatOverride) {
  if (typeof window === "undefined") return;
  try {
    if (value === "auto") window.localStorage.removeItem(ODDS_FORMAT_STORAGE_KEY);
    else window.localStorage.setItem(ODDS_FORMAT_STORAGE_KEY, value);
    window.dispatchEvent(new Event(STORAGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function useOddsFormatOverride(): OddsFormatOverride {
  const [value, setValue] = useState<OddsFormatOverride>("auto");
  useEffect(() => {
    setValue(readOverride());
    const onChange = () => setValue(readOverride());
    window.addEventListener("storage", onChange);
    window.addEventListener(STORAGE_EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(STORAGE_EVENT, onChange);
    };
  }, []);
  return value;
}

/** Resolved odds format for a domain, honouring user override. */
export function useOddsFormat(domain: DomainId | null | undefined): OddsFormat {
  const override = useOddsFormatOverride();
  if (override !== "auto") return override;
  if (!domain) return "decimal";
  return DOMAIN_DEFAULT_FORMAT[domain] ?? "decimal";
}
