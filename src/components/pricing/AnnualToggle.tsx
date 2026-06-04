interface AnnualToggleProps {
  value: "monthly" | "annual";
  onChange: (value: "monthly" | "annual") => void;
}

export function AnnualToggle({ value, onChange }: AnnualToggleProps) {
  return (
    <div
      className="inline-flex rounded-full p-1 border"
      style={{ background: "var(--bg)", borderColor: "var(--line)" }}
    >
      <button
        onClick={() => onChange("monthly")}
        className="px-4 py-1.5 rounded-full text-sm font-medium transition-colors"
        style={{
          background: value === "monthly" ? "var(--ink)" : "transparent",
          color: value === "monthly" ? "white" : "var(--ink)",
        }}
      >
        Monthly
      </button>
      <button
        onClick={() => onChange("annual")}
        className="px-4 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-2"
        style={{
          background: value === "annual" ? "var(--ink)" : "transparent",
          color: value === "annual" ? "white" : "var(--ink)",
        }}
      >
        Annual
        <span
          className="text-xs px-1.5 py-0.5 rounded-full font-semibold"
          style={{
            background: value === "annual" ? "var(--amber)" : "var(--green, #16a34a)",
            color: "white",
            letterSpacing: "0.02em",
          }}
        >
          {"-17%"}
        </span>
      </button>
    </div>
  );
}
