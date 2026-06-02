import { createFileRoute } from "@tanstack/react-router";
import { WhatWeAnalyseSection } from "@/components/site/WhatWeAnalyseSection";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "How it works — Prophiq" },
      {
        name: "description",
        content:
          "An honest look at what the Prophiq engine does, what it analyses, and how it has done so far.",
      },
      { property: "og:title", content: "How it works — Prophiq" },
      {
        property: "og:description",
        content:
          "What the Prophiq engine analyses, and how it forecasts every upcoming event.",
      },
    ],
  }),
  component: AboutPage,
});

const STEPS = [
  {
    n: "01",
    title: "Discover.",
    body: "An autonomous engine pulls every upcoming event from across the web every few hours — sport, politics, markets, entertainment.",
  },
  {
    n: "02",
    title: "Forecast.",
    body: "For each event, the Prophiq engine reasons across the factors above and produces a calibrated probability for every possible outcome.",
  },
  {
    n: "03",
    title: "Score.",
    body: "When the event happens, we record what actually occurred. Every forecast is scored. The running track record is public.",
  },
];

function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl">
        <section className="px-5 pb-7 pt-9">
          <h1
            className="font-display tracking-[-0.035em]"
            style={{
              fontWeight: 700,
              lineHeight: 0.96,
              fontSize: "clamp(40px, 9vw, 56px)",
            }}
          >
            How Prophiq
            <br />
            <span style={{ color: "var(--amber)" }}>works.</span>
          </h1>
          <p
            className="mt-5 max-w-[40ch] font-body text-[16px] leading-[1.45]"
            style={{ color: "var(--ink-soft)" }}
          >
            An honest look at what the engine does, what it analyses, and how it
            has done so far.
          </p>
        </section>

        <SectionHeader label="WHAT WE ANALYSE" />
        <section className="px-5 pb-8 pt-3">
          <WhatWeAnalyseSection />
        </section>

        <SectionHeader label="HOW WE FORECAST" />
        <section className="space-y-5 px-5 pb-8 pt-4">
          {STEPS.map((s) => (
            <div key={s.n}>
              <span
                className="font-mono text-[11px] tracking-[0.18em]"
                style={{ color: "var(--amber-strong)", fontWeight: 600 }}
              >
                {s.n}
              </span>
              <p
                className="mt-1 font-display text-[20px] leading-snug tracking-[-0.01em]"
                style={{ fontWeight: 600 }}
              >
                <span style={{ color: "var(--ink)" }}>{s.title}</span>{" "}
                <span style={{ color: "var(--ink-soft)" }}>{s.body}</span>
              </p>
            </div>
          ))}
        </section>

        <SectionHeader label="TRACK RECORD" />
        <section className="px-5 pb-8 pt-3" id="track-record">
          <div
            className="rounded-xl px-4 py-5"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-soft)",
              color: "var(--ink-soft)",
            }}
          >
            <p className="font-body text-[13px] leading-relaxed">
              Every forecast is graded after the event resolves. The running
              tally — events scored, top-pick hit rate, top-3 hit rate — is
              public and updates automatically.
            </p>
          </div>
        </section>

        <SectionHeader label="HYGIENE" />
        <section className="px-5 pb-12 pt-3">
          <p
            className="font-body text-[13px] leading-relaxed"
            style={{ color: "var(--ink-soft)" }}
          >
            Prophiq is not a betting tipster, not a financial adviser, and not a
            crystal ball. Forecasts are probabilistic and informational only.
            Markets coverage is not financial advice. Politics coverage is
            non-partisan. Sport odds framing is for entertainment — please{" "}
            <a
              href="https://www.begambleaware.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--ink)" }}
            >
              gamble responsibly
            </a>
            .
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-5 pb-2 pt-2">
      <span
        className="font-mono text-[10px] tracking-[0.2em]"
        style={{ color: "var(--ink-faint)", fontWeight: 600 }}
      >
        {label}
      </span>
      <span
        className="h-px flex-1"
        style={{ background: "var(--border-soft)" }}
      />
    </div>
  );
}
