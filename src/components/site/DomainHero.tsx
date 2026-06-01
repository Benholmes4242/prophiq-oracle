import type { DomainId } from "@/lib/types";

interface DomainHeroProps {
  domain: DomainId;
}

const DOMAIN_COPY: Record<DomainId, { eyebrow: string; headlineLines: [string, string]; sub: string }> = {
  sport: {
    eyebrow: "SPORT",
    headlineLines: ["Sport.", "What wins?"],
    sub: "Fixtures, finals, and head-to-head calls. Calibrated forecasts on every upcoming event.",
  },
  politics: {
    eyebrow: "POLITICS",
    headlineLines: ["Politics.", "Who wins?"],
    sub: "Elections, leadership contests, and political moments. Non-partisan forecasts on every upcoming event.",
  },
  markets: {
    eyebrow: "MARKETS",
    headlineLines: ["Markets.", "What moves?"],
    sub: "Earnings, central banks, and macro prints. Informational forecasts on every upcoming event.",
  },
  entertainment: {
    eyebrow: "ENTERTAINMENT",
    headlineLines: ["Entertainment.", "What wins?"],
    sub: "Awards, releases, and finales. Calibrated forecasts on every upcoming event.",
  },
};

export function DomainHero({ domain }: DomainHeroProps) {
  const copy = DOMAIN_COPY[domain];
  return (
    <section className="px-5 pb-7 pt-9">
      <p
        className="font-mono text-[10px] tracking-[0.22em]"
        style={{ color: "var(--amber-strong)", fontWeight: 600 }}
      >
        {copy.eyebrow}
      </p>
      <h1
        className="mt-3 font-display tracking-[-0.03em]"
        style={{
          fontWeight: 700,
          lineHeight: 0.94,
          fontSize: "clamp(40px, 11vw, 56px)",
        }}
      >
        {copy.headlineLines[0]}
        <br />
        <span style={{ color: "var(--amber)" }}>{copy.headlineLines[1]}</span>
      </h1>
      <p
        className="mt-5 max-w-[34ch] font-body text-[16px] leading-[1.45]"
        style={{ color: "var(--ink-soft)" }}
      >
        {copy.sub}
      </p>
    </section>
  );
}
