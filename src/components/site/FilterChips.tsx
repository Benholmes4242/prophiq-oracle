interface FilterChipsProps {
  chips: string[];
  active: string;
  onChange: (chip: string) => void;
}

export function FilterChips({ chips, active, onChange }: FilterChipsProps) {
  return (
    <div className="chips-scroll -mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1">
      {chips.map((chip) => {
        const isActive = chip === active;
        return (
          <button
            key={chip}
            type="button"
            onClick={() => onChange(chip)}
            className="shrink-0 whitespace-nowrap rounded-full font-medium active:scale-[0.97]"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              padding: "7px 14px",
              border: `1px solid ${isActive ? "var(--ink)" : "var(--line)"}`,
              background: isActive ? "var(--ink)" : "transparent",
              color: isActive ? "#fff" : "var(--ink-soft)",
              letterSpacing: "-0.005em",
              transition: "all 180ms var(--ease-ios)",
            }}
            aria-pressed={isActive}
          >
            {chip}
          </button>
        );
      })}
    </div>
  );
}
