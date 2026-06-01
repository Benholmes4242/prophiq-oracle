import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <footer
      className="mt-16 border-t"
      style={{ borderColor: "var(--border-soft)" }}
    >
      <div className="mx-auto max-w-2xl px-5 py-8">
        <div className="mb-3 flex items-center gap-2">
          <span
            aria-hidden
            className="grid h-5 w-5 place-items-center rounded text-white"
            style={{
              background: "var(--amber)",
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: 11,
              letterSpacing: "-0.05em",
            }}
          >
            P
          </span>
          <span
            className="font-display tracking-[-0.02em]"
            style={{ fontWeight: 700, fontSize: 14 }}
          >
            Prophiq
          </span>
        </div>
        <nav
          aria-label="Footer"
          className="mb-3 flex flex-wrap gap-x-4 gap-y-1 font-body text-[12.5px]"
          style={{ color: "var(--ink-soft)" }}
        >
          <Link to="/about" className="hover:text-[var(--ink)]">
            How it works
          </Link>
          <Link to="/receipts" className="hover:text-[var(--ink)]">
            Receipts
          </Link>
          <Link to="/predictions" className="hover:text-[var(--ink)]">
            All predictions
          </Link>
        </nav>
        <p
          className="font-body text-[11.5px] leading-relaxed"
          style={{ color: "var(--ink-faint)" }}
        >
          Forecasts are informational only. Markets coverage is not financial
          advice. We do not endorse any candidate or party. 18+ where applicable.
        </p>
      </div>
    </footer>
  );
}
