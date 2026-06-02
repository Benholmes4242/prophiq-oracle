import type { DomainId } from "@/lib/types";

interface DomainHeroProps {
  domain: DomainId;
}

const DOMAIN_COPY: Record<DomainId, { title: string; sub: string }> = {
  sport: {
    title: "Sport",
    sub: "Fixtures, finals, and head-to-head calls — calibrated.",
  },
  politics: {
    title: "Politics",
    sub: "Elections, contests, and political moments — non-partisan.",
  },
  markets: {
    title: "Markets",
    sub: "Earnings, central banks, and macro prints — informational.",
  },
  entertainment: {
    title: "Entertainment",
    sub: "Awards, releases, and finales — calibrated.",
  },
};

export function DomainHero({ domain }: DomainHeroProps) {
  const copy = DOMAIN_COPY[domain];
  return (
    <section className="px-5 pb-6 pt-9">
      <h1
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 700,
          fontSize: 40,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color: "var(--ink)",
        }}
      >
        {copy.title}
        <span style={{ color: "var(--amber)" }}>.</span>
      </h1>
      <p
        className="mt-4 max-w-[36ch]"
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 15.5,
          lineHeight: 1.45,
          color: "var(--ink-soft)",
          letterSpacing: "-0.005em",
        }}
      >
        {copy.sub}
      </p>
    </section>
  );
}
