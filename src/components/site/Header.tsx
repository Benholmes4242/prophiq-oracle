import { Link } from "@tanstack/react-router";

const NAV = [
  { to: "/predictions", label: "Predictions" },
  { to: "/sport", label: "Sport" },
  { to: "/politics", label: "Politics" },
  { to: "/markets", label: "Markets" },
  { to: "/entertainment", label: "Entertainment" },
  { to: "/about", label: "About" },
] as const;

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--brand-border)] bg-[color-mix(in_oklab,var(--brand-bg)_85%,transparent)] backdrop-blur supports-[backdrop-filter]:bg-[color-mix(in_oklab,var(--brand-bg)_70%,transparent)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-md bg-[var(--brand-amber)] text-white font-black"
          >
            P
          </span>
          <span className="text-base font-semibold tracking-tight text-[var(--brand-ink)]">
            Prophiq
          </span>
        </Link>

        <nav className="hidden flex-1 items-center justify-center gap-5 text-sm md:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeProps={{ className: "text-[var(--brand-ink)] font-semibold" }}
              inactiveProps={{ className: "text-slate-600 hover:text-[var(--brand-ink)]" }}
              className="transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          to="/ask"
          className="inline-flex items-center rounded-full bg-[var(--brand-amber)] px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-px hover:shadow"
        >
          Ask Prophiq
        </Link>
      </div>

      {/* Mobile nav strip */}
      <div className="border-t border-[var(--brand-border)] md:hidden">
        <nav className="mx-auto flex max-w-6xl items-center gap-4 overflow-x-auto px-4 py-2 text-xs">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeProps={{ className: "text-[var(--brand-ink)] font-semibold" }}
              inactiveProps={{ className: "text-slate-600" }}
              className="whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
