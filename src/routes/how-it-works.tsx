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
          "Multi-model AI consensus, grounded in live data and our own forecasting database, calibrated against reality.",
      },
      {
        property: "og:title",
        content: "How Prophiq forecasts the future",
      },
      {
        property: "og:description",
        content:
          "Multi-model AI consensus, grounded in live data and our own forecasting database, calibrated against reality.",
      },
    ],
  }),
  component: HowItWorksPage,
});

// ============================================================
// Content
// ============================================================

const LAYERS = [
  {
    title: "Our own forecasting database",
    body: "Built and refined over thousands of forecasts, with continuous event discovery, classification, and curation tuned for each domain. Every resolved forecast feeds back into our calibration system.",
  },
  {
    title: "Live data from authoritative sources",
    body: "Real-time feeds from official data providers, government statistical agencies, prediction market platforms, and industry-standard databases. The exact mix depends on the domain, so forecasts always rest on domain-appropriate evidence.",
  },
  {
    title: "Multi-model AI reasoning",
    body: "Multiple frontier AI reasoning models analyze the assembled evidence independently. Their outputs are combined via a consensus algorithm so no single model's quirks dominate the answer.",
  },
  {
    title: "Honest data grounding",
    body: "Every forecast shows how it is grounded. When live feed data covers an event - real runners, real tournament fields, real prices - the forecast is built on it directly. When no feed exists, live research grounds it instead. Prophiq never invents a favourite or fakes a number, and when a field is not yet set, it says so.",
  },
];

const DOMAINS = [
  {
    id: "sport",
    title: "Sport",
    icon: "trophy",
    examples:
      "Match outcomes, championship winners, player milestones, tournament progression.",
    sources:
      "Live data covering horse racing across the UK, Ireland and North America, golf across all the major professional tours, football, and more - real runners, real fields, real competitors as the outcomes.",
  },
  {
    id: "politics",
    title: "Politics",
    icon: "ballot",
    examples:
      "Elections, leadership changes, policy outcomes, geopolitical events.",
    sources:
      "Real-time prices from leading prediction market platforms, providing crowd consensus alongside our AI analysis.",
  },
  {
    id: "markets",
    title: "Markets",
    icon: "chart",
    examples:
      "Economic indicators, earnings, central bank decisions, macroeconomic releases.",
    sources:
      "Official government economic data sources covering leading indicators, inflation, employment, interest rates and GDP, plus live market data feeds.",
  },
  {
    id: "entertainment",
    title: "Entertainment",
    icon: "star",
    examples:
      "Award winners, release performance, cultural milestones.",
    sources:
      "Industry-standard entertainment databases and leading music industry data sources for cultural signals.",
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Understanding what you mean",
    body: "You ask in plain language. If your question is clear, Prophiq forecasts straight away. If it could mean more than one thing - \"who wins the US Open\" could be tennis or golf, across several tours - Prophiq asks, in natural conversation, until it knows exactly which event you mean. It never guesses, and it never dead-ends. Only once it is sure does it move on.",
  },
  {
    n: "02",
    title: "Live research and structured data",
    body: "Real-time AI research pulls the latest context from the moment your forecast is requested. In parallel, the relevant domain-specific data sources are queried, so a forecast about a central bank rate decision sees the actual current interest rate from authoritative macro sources, and a forecast about a match or tournament sees the latest real runners, real fields, real competitors and prices from established sports data feeds. All evidence is assembled and combined with Prophiq's own historical forecasting data before reasoning begins.",
  },
  {
    n: "03",
    title: "Multi-model consensus",
    body: "Multiple frontier AI reasoning models analyze the evidence independently. Each produces its own probability estimate. When models disagree, that disagreement itself is signal worth examining.",
  },
  {
    n: "04",
    title: "Calibrated consensus",
    body: "A consensus algorithm combines the models' outputs into a single forecast. Confidence labels reflect how strongly the models agree with each other, where high confidence means the models converged on similar probabilities, and lower confidence means they split.",
  },
];

const WHY = [
  {
    title: "Live data, not just training data",
    body: "Foundation models know what they learned during training, which can be months or years stale. Prophiq queries live data sources at forecast time: real-time prediction market prices, the most recent economic data prints, current sports standings, latest entertainment industry signals. Your forecast reflects the world as it is now, not as it was when the model was trained.",
  },
  {
    title: "Multiple models check each other",
    body: "Single-model forecasts are confidently wrong too often. By running the same question through multiple independent frontier AI models, then combining their answers via a consensus algorithm, we surface real signal and dampen individual model quirks. When the models agree, that's meaningful. When they disagree, that disagreement is itself information.",
  },
  {
    title: "Track record, not vibes",
    body: "Every forecast is logged. Every resolution is recorded. We compute calibration metrics so the accuracy of Prophiq's forecasts is measurable, not just claimed. Forecasting tools that don't publish their calibration shouldn't be trusted.",
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
      <LayersSection />
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
          maxWidth: "52ch",
        }}
      >
        Multi-model AI consensus, grounded in live data and our own forecasting
        database, calibrated against reality.
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

// --- Section: layers ---

function LayersSection() {
  return (
    <section>
      <SectionEyebrow>Three layers feed every forecast</SectionEyebrow>
      <SectionHeading>The foundation underneath every answer.</SectionHeading>
      <EditorialP>
        Prophiq doesn&apos;t just ask an AI model a question. Three layers of
        intelligence feed every forecast, in a process we&apos;ve refined over
        thousands of events.
      </EditorialP>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
          marginTop: 18,
        }}
      >
        {LAYERS.map((l, i) => (
          <div
            key={l.title}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--line)",
              borderRadius: 14,
              padding: 18,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.18em",
                color: "var(--amber-2)",
                marginBottom: 8,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </div>
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontWeight: 700,
                fontSize: 16,
                letterSpacing: "-0.02em",
                color: "var(--ink)",
                marginBottom: 8,
              }}
            >
              {l.title}
            </div>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 13.5,
                lineHeight: 1.5,
                color: "var(--ink-soft)",
                letterSpacing: "-0.005em",
                margin: 0,
              }}
            >
              {l.body}
            </p>
          </div>
        ))}
      </div>
    </section>
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
        How we ground it
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
        Every forecast goes through a four-step process. We don&apos;t just ask
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
        Three reasons Prophiq forecasts differently from asking an AI chatbot
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
