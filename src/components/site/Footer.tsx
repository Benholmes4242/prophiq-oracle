export function Footer() {
  return (
    <footer
      className="border-t px-5 py-8"
      style={{ borderColor: "var(--border-soft)" }}
    >
      <div className="mx-auto max-w-2xl">
        <p
          className="font-body text-[11.5px] leading-[1.5]"
          style={{ color: "var(--ink-faint)" }}
        >
          Forecasts are informational only. Markets coverage is not financial
          advice. We do not endorse any candidate or party. 18+ where
          applicable.
        </p>
        <p
          className="mt-3 font-body text-[11.5px]"
          style={{ color: "var(--ink-faint)" }}
        >
          © {new Date().getFullYear()} Prophiq.
        </p>
      </div>
    </footer>
  );
}
