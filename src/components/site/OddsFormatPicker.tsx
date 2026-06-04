// OddsFormatPicker — user override for odds display format. Persists to
// localStorage under `prophiq:odds-format`. "Auto" clears the override and
// falls back to the per-domain default (sport=fractional, markets=decimal,
// entertainment=decimal, politics=percent-only).

import {
  ODDS_FORMAT_STORAGE_KEY,
  setOddsFormatOverride,
  useOddsFormatOverride,
  type OddsFormatOverride,
} from "@/hooks/useOddsFormat";

const OPTIONS: Array<{ value: OddsFormatOverride; label: string }> = [
  { value: "auto", label: "Auto (by domain)" },
  { value: "decimal", label: "Decimal" },
  { value: "fractional", label: "Fractional" },
  { value: "american", label: "American" },
  { value: "percent-only", label: "Percent only" },
];

export function OddsFormatPicker() {
  const value = useOddsFormatOverride();
  return (
    <label className="block px-5 py-2">
      <span
        className="mb-1.5 block font-mono text-[10px] font-semibold uppercase"
        style={{ letterSpacing: "0.22em", color: "var(--ink-faint)" }}
      >
        Odds format
      </span>
      <select
        value={value}
        onChange={(e) =>
          setOddsFormatOverride(e.target.value as OddsFormatOverride)
        }
        name={ODDS_FORMAT_STORAGE_KEY}
        className="w-full rounded-md border bg-transparent px-2.5 py-1.5 font-body text-[13.5px]"
        style={{
          borderColor: "var(--border-soft)",
          color: "var(--ink)",
          background: "var(--bg-card)",
        }}
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
