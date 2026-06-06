import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { WordmarkTagline } from "@/components/brand/WordmarkTagline";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How Prophiq forecasts the future" },
      {
        name: "description",
        content:
          "Multi-model AI consensus, grounded in live data, calibrated against reality. Three frontier models, eight structured data sources, four domains.",
      },
      {
        property: "og:title",
        content: "How Prophiq forecasts the future",
      },
      {
        property: "og:description",
        content:
          "Multi-model AI consensus, grounded in live data, calibrated against reality.",
      },
    ],
  }),
  component: HowItWorksPage,
});

// ============================================================
// Content
// ============================================================

const DOMAINS = [
  {
    id: "sport",
    title: "Sport",
    icon: "trophy",
    examples:
      "Match outcomes, championship winners, player milestones, tournament progression.",
    sources:
      "football-data.org (top European football leagues), TheSportsDB (multi-sport coverage including F1, NBA, NHL, cricket, MMA).",
  },
  {
    id: "politics",
    title: "Politics",
    icon: "ballot",
    examples:
      "Elections, leadership changes, policy outcomes, geopolitical events.",
    sources:
      "Polymarket and Kalshi prediction market prices, providing real-time crowd consensus alongside our AI analysis.",
  },
  {
    id: "markets",
    title: "Markets",
    icon: "chart",
    examples:
      "Economic indicators, earnings, central bank decisions, macroeconomic releases.",
    sources:
      "FRED for macro series (LEI, CPI, NFP, Unemployment Rate, Fed Funds Rate, GDP), Alpha Vantage for ticker-level data.",
  },
  {
    id: "entertainment",
    title: "Entertainment",
    icon: "star",
    examples:
      "Award winners, release performance, cultural milestones.",
    sources:
      "TMDb for film and TV data, Spotify for music industry signals.",
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Question or event",
    body: "A user submits a question, or Prophiq's discovery system surfaces an upcoming event automatically. The event gets classified into one of the four domains before any analysis begins.",
  },
  {
    n: "02",
    title: "Live research and structured data",
    body: "Perplexity researches the latest context in real time, pulling in news and analysis from the moment your forecast is requested. In parallel, the relevant domain-specific data sources are queried, so a forecast about a Fed rate decision sees the actual current Fed Funds Rate from FRED, and a forecast about a Premier League match sees the latest standings from football-data.org. All evidence is assembled before reasoning begins.",
  },
  {
    n: "03",
    title: "Multi-model consensus",
    body: "Three frontier AI models analyze the evidence independently: Claude (Anthropic), GPT (OpenAI), and Gemini (Google). Each produces its own probability estimate. When models disagree, that disagreement itself is signal worth examining.",
  },
  {
    n: "04",
    title: "Calibrated consensus",
    body: "A Borda count consensus algorithm combines the three models' outputs into a single forecast. Confidence labels reflect how strongly the models agree with each other: high confidence means all three converged on similar probabilities, lower confidence means the models split.",
  },
];

const WHY = [
  {
    title: "Live data, not just training data",
    body: "Foundation models know what they learned during training, which can be months or years stale. Prophiq queries live data sources at forecast time: Polymarket prices from minutes ago, the most recent CPI print, current sports standings. Your forecast reflects the world as it is now, not as it was when the model was trained.",
  },
  {
    title: "Three models check each other",
    body: "Single-LLM forecasts are confidently wrong too often. By running the same question through Claude, GPT, and Gemini independently, then combining their answers via a consensus algorithm, we surface real signal and dampen individual model quirks. When all three agree, that's meaningful. When they disagree, that disagreement is itself information.",
  },
  {
    title: "Track record, not vibes",
    body: "Every forecast is logged. Every resolution is recorded. We compute Brier scores and reliability curves so the accuracy of Prophiq's forecasts is measurable, not just claimed. Forecasting tools that don't publish their calibration shouldn't be trusted.",
  },
];

const NOT_DOING = [
  {
    head: "We don't predict markets in seconds.",
    body: "This isn't day trading or high-frequency. Our forecasts are for events that resolve over hours, days, or months.",
  },
  {
    head: "We don't claim certainty.",
    body: "Every forecast has a confidence range. A 70% forecast means we expect that outcome 70% of the time, not 100%.",
  },
  {
    head: "We don't cover every event.",
    body: "We focus on the four domains where structured data exists and where forecasts have meaning. We won't forecast lottery numbers, the weather in five days, or your love life.",
  },
  {
    head: "We're not a betting service.",
    body: "We provide calibrated forecasts. What you do with them is your decision.",
  },
];

// ============================================================
// Page
// ============================================================

function HowItWorksPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 pb-16 pt-8">
      <Hero />
      <Divider />
      <DomainsSection />
      <Divider />
      <EngineSection />
      <Divider />
      <WhySection />
      <Divider />
      <DailyLockSection />
      <Divider />
      <NotDoingSection />
      <Closing />
    </main>
  );
}

function Hero() {
  return (
    <header style={{ marginBottom: 36 }}>
      <WordmarkTagline wordmarkSize={32} className="mb-7" />
      <h1
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 700,
          fontSize: 38,
          letterSpacing: "-0.035em",
          lineHeight: 1.02,
          color: "var(--ink)",
          marginBottom: 14,
        }}
      >
        How Prophiq forecasts the
        <span style={{ color: "var(--amber)" }}> future.</span>
      </h1>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 16,
          lineHeight: 1.5,
          color: "var(--ink-soft)",
          letterSpacing: "-0.005em",
          maxWidth: "42ch",
        }}
      >
        Multi-model AI consensus, grounded in live data, calibrated against
        reality.
      </p>
    </header>
  );
}

function Divider() {
  return (
    <hr
      style={{
        border: "none",
        height: 1,
        background: "var(--amber)",
        opacity: 0.6,
        margin: "32px 0",
      }}
    />
  );
}

function SectionEyebrow({ children }: { children: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: "var(--ink-faint)",
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "var(--font-sans)",
        fontWeight: 700,
        fontSize: 24,
        letterSpacing: "-0.03em",
        lineHeight: 1.15,
        color: "var(--ink)",
        marginBottom: 14,
      }}
    >
      {children}
    </h2>
  );
}

function EditorialP({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: 15.5,
        lineHeight: 1.55,
        color: "var(--ink-soft)",
        letterSpacing: "-0.005em",
        marginBottom: 14,
      }}
    >
      {children}
    </p>
  );
}

// --- Section: domains ---

function DomainsSection() {
  return (
    <section>
      <SectionEyebrow>The four domains</SectionEyebrow>
      <SectionHeading>What Prophiq covers.</SectionHeading>
      <EditorialP>
        Prophiq covers four domains. Each gets data sources specifically
        relevant to that field, so the underlying evidence is always
        domain-appropriate rather than generic.
      </EditorialP>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
          marginTop: 18,
        }}
      >
        {DOMAINS.map((d) => (
          <DomainCard key={d.id} d={d} />
        ))}
      </div>
    </section>
  );
}

function DomainCard({
  d,
}: {
  d: (typeof DOMAINS)[number];
}) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <DomainIcon name={d.icon} />
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontWeight: 700,
            fontSize: 17,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
          }}
        >
          {d.title}
        </div>
      </div>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13.5,
          lineHeight: 1.5,
          color: "var(--ink)",
          letterSpacing: "-0.005em",
          marginBottom: 10,
        }}
      >
        {d.examples}
      </p>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--amber-2)",
          marginBottom: 6,
        }}
      >
        Data sources
      </div>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 12.5,
          lineHeight: 1.5,
          color: "var(--ink-soft)",
          letterSpacing: "-0.005em",
          margin: 0,
        }}
      >
        {d.sources}
      </p>
    </div>
  );
}

function DomainIcon({ name }: { name: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--amber)",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "trophy":
      return (
        <svg {...common}>
          <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" />
          <path d="M17 4h3v2a3 3 0 0 1-3 3M7 4H4v2a3 3 0 0 0 3 3" />
        </svg>
      );
    case "ballot":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 10h8M8 14h5" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <path d="M3 20h18" />
          <path d="M5 16l4-5 4 3 6-8" />
        </svg>
      );
    case "star":
      return (
        <svg {...common}>
          <path d="M12 3l2.6 5.6 6 .7-4.4 4.2 1.2 6L12 16.8 6.6 19.5l1.2-6L3.4 9.3l6-.7L12 3z" />
        </svg>
      );
    default:
      return null;
  }
}

// --- Section: engine ---

function EngineSection() {
  return (
    <section>
      <SectionEyebrow>The forecasting engine</SectionEyebrow>
      <SectionHeading>A four-step pipeline.</SectionHeading>
      <EditorialP>
        Each forecast goes through a four-step process. We don&apos;t just ask
        one AI model and hope for the best.
      </EditorialP>
      <div style={{ marginTop: 20 }}>
        {STEPS.map((s, i) => (
          <div
            key={s.n}
            style={{
              display: "flex",
              gap: 16,
              padding: "18px 0",
              borderTop: "1px solid var(--line)",
              borderBottom:
                i === STEPS.length - 1 ? "1px solid var(--line)" : undefined,
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "var(--amber)",
                color: "white",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 700,
                display: "grid",
                placeItems: "center",
                letterSpacing: "0.04em",
              }}
            >
              {s.n}
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: 600,
                  fontSize: 16,
                  color: "var(--ink)",
                  letterSpacing: "-0.02em",
                  marginBottom: 6,
                }}
              >
                {s.title}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: "var(--ink-soft)",
                  letterSpacing: "-0.005em",
                }}
              >
                {s.body}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- Section: why ---

function WhySection() {
  return (
    <section>
      <SectionEyebrow>Why this matters</SectionEyebrow>
      <SectionHeading>What makes Prophiq different.</SectionHeading>
      <EditorialP>
        Three reasons Prophiq forecasts differently from asking ChatGPT
        &quot;what&apos;s the probability of X?&quot;
      </EditorialP>
      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        {WHY.map((w, i) => (
          <div
            key={w.title}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--line)",
              borderRadius: 14,
              padding: 18,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--amber-2)",
                  letterSpacing: "0.06em",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: 600,
                  fontSize: 16,
                  color: "var(--ink)",
                  letterSpacing: "-0.02em",
                }}
              >
                {w.title}
              </span>
            </div>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 14,
                lineHeight: 1.55,
                color: "var(--ink-soft)",
                letterSpacing: "-0.005em",
                margin: 0,
              }}
            >
              {w.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- Section: daily lock ---

function DailyLockSection() {
  return (
    <section>
      <SectionEyebrow>The daily lock</SectionEyebrow>
      <SectionHeading>Editorial curation, every morning.</SectionHeading>
      <EditorialP>
        Every day at 06:00 UTC, Prophiq selects the six most consequential
        forecasts across all domains, one per slot. These are the day&apos;s
        headline forecasts, surfaced to all users. Below the headlines, each
        domain gets a &quot;lead forecast&quot; highlighted on its dedicated
        page.
      </EditorialP>
      <div
        style={{
          background: "var(--bg-tint)",
          border: "1px solid rgba(244, 115, 26, 0.2)",
          borderRadius: 14,
          padding: 18,
          marginTop: 12,
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--ink)",
            letterSpacing: "-0.005em",
            margin: 0,
          }}
        >
          Users want curation, not 400 events to sift through. The daily lock
          is our editorial signal: of everything happening today, here&apos;s
          what&apos;s most worth your attention.
        </p>
      </div>
    </section>
  );
}

// --- Section: not doing ---

function NotDoingSection() {
  return (
    <section>
      <SectionEyebrow>What we don&apos;t do</SectionEyebrow>
      <SectionHeading>Honest expectations.</SectionHeading>
      <EditorialP>
        Honest expectations matter for a forecasting tool. Here&apos;s what
        Prophiq is not.
      </EditorialP>
      <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0" }}>
        {NOT_DOING.map((n) => (
          <li
            key={n.head}
            style={{
              padding: "14px 0",
              borderTop: "1px solid var(--line)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontWeight: 600,
                fontSize: 15,
                color: "var(--ink)",
                letterSpacing: "-0.015em",
                marginBottom: 4,
              }}
            >
              {n.head}
            </div>
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 14,
                lineHeight: 1.5,
                color: "var(--ink-soft)",
                letterSpacing: "-0.005em",
              }}
            >
              {n.body}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Closing() {
  return (
    <div
      style={{
        textAlign: "center",
        paddingTop: 36,
        marginTop: 36,
        borderTop: "1px solid var(--line)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          color: "var(--ink-soft)",
          marginBottom: 16,
        }}
      >
        Got a question? Ask Prophiq.
      </p>
      <Link
        to="/"
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          fontWeight: 600,
          color: "white",
          textDecoration: "none",
          padding: "11px 22px",
          background: "var(--amber)",
          borderRadius: 100,
          display: "inline-block",
          boxShadow: "0 2px 8px rgba(244, 115, 26, 0.25)",
        }}
      >
        Ask something →
      </Link>
    </div>
  );
}
