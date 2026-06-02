import { Link } from "@tanstack/react-router";

interface AppHeaderProps {
  onMenuClick: () => void;
}

export function AppHeader({ onMenuClick }: AppHeaderProps) {
  return (
    <header
      className="mx-auto flex max-w-2xl items-center justify-between px-4 pb-1 pt-2.5"
      style={{ background: "var(--bg)" }}
    >
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open menu"
        className="grid h-11 w-11 place-items-center rounded-full transition-ios-colors hover:bg-[rgba(11,18,32,0.05)] active:bg-[rgba(11,18,32,0.1)]"
        style={{ color: "var(--ink)" }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      <Link
        to="/"
        aria-label="Prophiq home"
        className="grid h-[38px] w-[38px] place-items-center rounded-[11px] text-white"
        style={{
          background: "var(--amber)",
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: 20,
          letterSpacing: "-0.05em",
        }}
      >
        P
      </Link>

      <Link
        to="/search"
        aria-label="Search"
        className="grid h-11 w-11 place-items-center rounded-full transition-ios-colors hover:bg-[rgba(11,18,32,0.05)]"
        style={{ color: "var(--ink)" }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" strokeLinecap="round" />
        </svg>
      </Link>
    </header>
  );
}
