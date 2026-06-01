import { Link } from "@tanstack/react-router";
import { DigestSignup } from "./DigestSignup";

const FOOTER_LINKS = {
  Product: [
    { label: "Ask", to: "/ask" },
    { label: "Receipts", to: "/receipts" },
    { label: "All predictions", to: "/predictions" },
    { label: "Your questions", to: "/my-questions" },
  ],
  Domains: [
    { label: "Sport", to: "/sport" },
    { label: "Politics", to: "/politics" },
    { label: "Markets", to: "/markets" },
    { label: "Entertainment", to: "/entertainment" },
  ],
  About: [
    { label: "How it works", to: "/about" },
    { label: "Privacy", to: "/privacy" },
    { label: "Terms", to: "/terms" },
    { label: "Contact", to: "/contact" },
  ],
} as const;

export function Footer() {
  return (
    <footer
      className="mt-16 border-t"
      style={{ borderColor: "var(--border-soft)" }}
    >
      <div className="mx-auto max-w-2xl px-5 py-10">
        <div className="mb-6 flex items-center gap-2">
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

        <p
          className="mb-7 font-body text-[13px] leading-relaxed"
          style={{ color: "var(--ink-soft)" }}
        >
          Calibrated forecasts for every upcoming event.
        </p>

        <div className="mb-8">
          <DigestSignup source="footer" />
        </div>


        <div className="mb-8 grid grid-cols-1 gap-7 sm:grid-cols-3">
          {Object.entries(FOOTER_LINKS).map(([heading, items]) => (
            <div key={heading}>
              <h3
                className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em]"
                style={{ color: "var(--ink-faint)", fontWeight: 600 }}
              >
                {heading}
              </h3>
              <ul className="space-y-1.5">
                {items.map((it) => (
                  <li key={it.to}>
                    <Link
                      to={it.to}
                      className="font-body text-[13px] hover:text-[var(--ink)]"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      {it.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          className="border-t pt-5"
          style={{ borderColor: "var(--border-soft)" }}
        >
          <p
            className="mb-2 font-body text-[12px]"
            style={{ color: "var(--ink-faint)" }}
          >
            © {new Date().getFullYear()} Prophiq.
          </p>
          <p
            className="font-body text-[11.5px] leading-relaxed"
            style={{ color: "var(--ink-faint)" }}
          >
            Forecasts are informational only. Markets coverage is not financial
            advice. We do not endorse any candidate or party. 18+ where
            applicable.
          </p>
        </div>
      </div>
    </footer>
  );
}
