interface FilterChipsProps {
  chips: string[];
  active: string;
  onChange: (chip: string) => void;
}

export function FilterChips({ chips, active, onChange }: FilterChipsProps) {
  return (
    <div className="chips-scroll -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
      {chips.map((chip) => {
        const isActive = chip === active;
        return (
          <button
            key={chip}
            type="button"
            onClick={() => onChange(chip)}
            className="shrink-0 whitespace-nowrap rounded-full font-body text-[12.5px] font-medium active:scale-[0.96]"
            style={{
              padding: "8px 13px",
              border: "none",
              background: isActive ? "var(--ink)" : "var(--chip-bg)",
              color: isActive ? "#fff" : "var(--ink-2)",
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
