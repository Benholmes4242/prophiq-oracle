import { Link } from "@tanstack/react-router";

export function Header() {
  return (
    <header
      className="border-b"
      style={{ borderColor: "var(--border-soft)", background: "var(--bg)" }}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-6 px-5 py-4 sm:py-5">
        <Link to="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-md text-white"
            style={{
              background: "var(--amber)",
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: 16,
              letterSpacing: "-0.05em",
            }}
          >
            P
          </span>
          <span
            className="font-display tracking-[-0.02em]"
            style={{ fontWeight: 700, fontSize: 20 }}
          >
            Prophiq
          </span>
        </Link>
        <Link
          to="/about"
          className="font-body text-[13px] transition-colors hover:text-[var(--ink)]"
          style={{ color: "var(--ink-soft)", fontWeight: 500 }}
        >
          How it works
        </Link>
      </div>
    </header>
  );
}
