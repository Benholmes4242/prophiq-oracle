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
            className="shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 font-body text-[12.5px] font-medium transition-colors"
            style={
              isActive
                ? {
                    background: "var(--ink)",
                    color: "#fff",
                    border: "1px solid var(--ink)",
                  }
                : {
                    background: "transparent",
                    color: "var(--ink-soft)",
                    border: "1px solid var(--border-strong)",
                  }
            }
            aria-pressed={isActive}
          >
            {chip}
          </button>
        );
      })}
    </div>
  );
}
