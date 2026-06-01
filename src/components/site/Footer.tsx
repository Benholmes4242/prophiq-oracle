import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-[var(--brand-border)] bg-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="grid h-6 w-6 place-items-center rounded bg-[var(--brand-amber)] text-white text-xs font-black"
              >
                P
              </span>
              <span className="font-semibold tracking-tight text-[var(--brand-ink)]">
                Prophiq
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              Multi-model consensus predictions for sport, politics, markets, and entertainment.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Domains
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link to="/sport" className="text-slate-700 hover:text-[var(--brand-ink)]">Sport</Link></li>
              <li><Link to="/politics" className="text-slate-700 hover:text-[var(--brand-ink)]">Politics</Link></li>
              <li><Link to="/markets" className="text-slate-700 hover:text-[var(--brand-ink)]">Markets</Link></li>
              <li><Link to="/entertainment" className="text-slate-700 hover:text-[var(--brand-ink)]">Entertainment</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Product
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link to="/predictions" className="text-slate-700 hover:text-[var(--brand-ink)]">All predictions</Link></li>
              <li><Link to="/ask" className="text-slate-700 hover:text-[var(--brand-ink)]">Ask a question</Link></li>
              <li><Link to="/about" className="text-slate-700 hover:text-[var(--brand-ink)]">About</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Hygiene
            </h3>
            <p className="mt-3 text-xs text-slate-600">
              Markets content is informational only and not financial advice. Politics coverage is
              non-partisan. Sport odds framing is for entertainment — please{" "}
              <a
                href="https://www.begambleaware.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--brand-ink)]"
              >
                gamble responsibly
              </a>
              .
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-[var(--brand-border)] pt-6 text-xs text-slate-500 sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} Prophiq.</span>
          <span className="max-w-xl text-center leading-relaxed sm:text-right">
            Prophiq is an AI-driven prediction platform. Forecasts are informational only, not
            advice. Markets coverage is not financial advice. We do not endorse any candidate or
            party. 18+ where applicable.
          </span>
        </div>
      </div>
    </footer>
  );
}
