// Small inline SVG icons for the "What we analyse" cards.

export type FactorName = "form" | "history" | "signals" | "stats";

const COMMON = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor" as const,
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function FactorIcon({ name }: { name: FactorName }) {
  switch (name) {
    case "form":
      return (
        <svg {...COMMON} aria-hidden>
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      );
    case "history":
      return (
        <svg {...COMMON} aria-hidden>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14a9 3 0 0 0 18 0V5" />
          <path d="M3 12a9 3 0 0 0 18 0" />
        </svg>
      );
    case "signals":
      return (
        <svg {...COMMON} aria-hidden>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case "stats":
      return (
        <svg {...COMMON} aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
  }
}
