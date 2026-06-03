import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useCalibrationHeadline } from "@/hooks/useCalibrationHeadline";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How it works - prophiq." },
      {
        name: "description",
        content:
          "How Prophiq's reasoning pipeline works. A multi-stage analytical engine, calibrated probabilities, and an accumulating calibration record.",
      },
    ],
  }),
  component: HowItWorksPage,
});

// ============================================================
// CONTENT - all hardcoded for v1, will be wired to real data later
// ============================================================

const ENGINE_STATS = {
  dataPointsPerCall: "Over 2,000+",
  avgResolutionTime: "< 8s",
};

const AGGREGATE = {
  resolvedCount: 247,
  avgCalibrationErrorPp: 5,
};

type FeaturedCall = {
  id: string;
  domain: string;
  outcome: "landed" | "miss";
  question: string;
  prophiqCallPct: number;
  outcomeLabel: string;
  takeaway: string;
};

const FEATURED_CALLS: FeaturedCall[] = [
  {
    id: "monaco-gp",
    domain: "F1 · Monaco GP",
    outcome: "landed",
    question: "Will Max Verstappen win the Monaco Grand Prix?",
    prophiqCallPct: 62,
    outcomeLabel: "Verstappen",
    takeaway:
      "A clean signal: Red Bull's chassis advantage on tight street circuits has been steady all season. **Confidence matched outcome.**",
  },
  {
    id: "uk-byelection",
    domain: "Politics · UK by-election",
    outcome: "landed",
    question: "Will Labour hold the seat?",
    prophiqCallPct: 54,
    outcomeLabel: "Labour, by 800",
    takeaway:
      "Polling markets had this at 85%. Prophiq saw a narrower contest. **The margin proved us closer than the consensus.**",
  },
  {
    id: "fed-june",
    domain: "Markets · Fed decision",
    outcome: "miss",
    question: "Will the Fed hold rates at its June meeting?",
    prophiqCallPct: 58,
    outcomeLabel: "25bps cut",
    takeaway:
      "A 58% call should miss about 42% of the time. **This was one of those.** Reading a 58% forecast as a guarantee misses the point.",
  },
  {
    id: "oscars-best-picture",
    domain: "Entertainment · Oscars",
    outcome: "landed",
    question: "Who wins Best Picture?",
    prophiqCallPct: 71,
    outcomeLabel: "Anora",
    takeaway:
      "Late guild momentum was the tell. **Higher confidence, landed at the higher rate.**",
  },
];

const PIPELINE = [
  {
    n: "01",
    label: "Research",
    desc: "Real-time data pulled from across the globe - historical patterns, market signals, expert commentary, breaking news.",
  },
  {
    n: "02",
    label: "Reasoning",
    desc: "An ensemble of frontier reasoning systems evaluates each question independently, ranking possible outcomes with calibrated probabilities.",
  },
  {
    n: "03",
    label: "Consensus",
    desc: "Prophiq's engine merges the independent rankings using a weighted Borda count, producing a single calibrated answer with reasoning.",
  },
];

const PROB_KEY = [
  { range: "50-59%", meaning: "A lean, but the outcome is close to a coin flip." },
  { range: "60-74%", meaning: "Likely. We have meaningful conviction." },
  { range: "75-89%", meaning: "Strong call. The signal is clear." },
  { range: "90%+", meaning: "High confidence. We'd be surprised if this didn't happen." },
];

// ============================================================
// PAGE
// ============================================================

function HowItWorksPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 pb-16 pt-8">
      <Hero />
      <EngineSection />
      <DataMoatSection />
      <PrincipleSection />
      <ProbabilityKeySection />
      <RecentCallsSection />
      <AggregateSection />
      <Closing />
    </main>
  );
}

function Hero() {
  return (
    <header style={{ marginBottom: 44 }}>
      <h1
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 700,
          fontSize: 40,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          color: "var(--ink)",
          marginBottom: 12,
        }}
      >
        How it works<span style={{ color: "var(--amber)" }}>.</span>
      </h1>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 15,
          lineHeight: 1.5,
          color: "var(--ink-soft)",
          maxWidth: "34ch",
          letterSpacing: "-0.005em",
        }}
      >
        A multi-stage reasoning pipeline. {ENGINE_STATS.dataPointsPerCall} data
        points per call. Resolved in seconds.
      </p>
    </header>
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

function SectionHeading({
  children,
  accent,
}: {
  children: ReactNode;
  accent?: string;
}) {
  return (
    <h2
      style={{
        fontFamily: "var(--font-sans)",
        fontWeight: 700,
        fontSize: 24,
        letterSpacing: "-0.03em",
        lineHeight: 1.15,
        color: "var(--ink)",
        marginBottom: 16,
      }}
    >
      {children}
      {accent && <span style={{ color: "var(--amber)" }}>{accent}</span>}
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
        marginBottom: 16,
      }}
    >
      {children}
    </p>
  );
}

function Em({ children }: { children: ReactNode }) {
  return (
    <span style={{ color: "var(--ink)", fontWeight: 500 }}>{children}</span>
  );
}

function EngineSection() {
  return (
    <section style={{ marginBottom: 48 }}>
      <SectionEyebrow>The engine</SectionEyebrow>
      <SectionHeading accent=".">
        A purpose-built reasoning pipeline
      </SectionHeading>

      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 17,
          lineHeight: 1.5,
          color: "var(--ink)",
          letterSpacing: "-0.01em",
          marginBottom: 20,
          fontWeight: 500,
        }}
      >
        <strong style={{ fontWeight: 700 }}>
          Built for one job: calibrated probabilistic forecasting.
        </strong>{" "}
        Where generalist AI gives you a paragraph of hedged language, Prophiq
        gives you a ranked, calibrated answer - backed by an ensemble of
        reasoning systems and a consensus engine purpose-built for the task.
      </p>

      <EditorialP>
        Every Prophiq call runs through a multi-stage analytical pipeline.
        Real-time research is pulled from across the globe, then evaluated
        independently by an ensemble of frontier reasoning systems.{" "}
        <Em>Prophiq's consensus engine</Em> merges their answers using a
        calibrated weighted Borda count - the same scoring method used in
        academic forecasting research.
      </EditorialP>

      <div style={{ marginTop: 20, marginBottom: 24 }}>
        {PIPELINE.map((step, i) => (
          <div
            key={step.n}
            style={{
              display: "flex",
              gap: 16,
              padding: "16px 0",
              borderTop: "1px solid var(--line)",
              borderBottom:
                i === PIPELINE.length - 1 ? "1px solid var(--line)" : undefined,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--amber-2)",
                letterSpacing: "0.06em",
                minWidth: 28,
                paddingTop: 2,
              }}
            >
              {step.n}
            </div>
            <div style={{ flex: 1 }}>
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
                {step.label}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: "var(--ink-soft)",
                  letterSpacing: "-0.005em",
                }}
              >
                {step.desc}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <StatCard
          value={ENGINE_STATS.dataPointsPerCall}
          label="Data points per call"
        />
        <StatCard
          value={ENGINE_STATS.avgResolutionTime}
          label="Avg. resolution time"
        />
      </div>
    </section>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: 16,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 700,
          fontSize: 28,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          color: "var(--ink)",
          marginBottom: 6,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function DataMoatSection() {
  return (
    <section style={{ marginBottom: 48 }}>
      <SectionEyebrow>The data</SectionEyebrow>
      <SectionHeading accent=".">
        Two layers of intelligence, one calibrated answer
      </SectionHeading>
      <EditorialP>
        <Em>Prophiq runs on two layers of intelligence in parallel.</Em>{" "}
        Real-time research pulled from across the globe - market signals,
        historical patterns, expert commentary, breaking news. And{" "}
        <Em>our own calibration record</Em> - a proprietary dataset of every
        call Prophiq has made and every outcome that resolved it, across all
        four domains.
      </EditorialP>
      <EditorialP>
        Both feed every forecast. Each resolved event becomes signal in the
        next call, sharpening calibration across the system.
      </EditorialP>
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          padding: 20,
          marginTop: 16,
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--ink-soft)",
            letterSpacing: "-0.005em",
          }}
        >
          Every forecast Prophiq makes is structured, scored, and folded back
          into the system.{" "}
          <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
            That feedback loop runs on every call - the layer no generalist AI
            carries.
          </strong>{" "}
          It's what makes Prophiq the right tool for decisions where calibration
          matters.
        </p>
      </div>
    </section>
  );
}

function PrincipleSection() {
  return (
    <section style={{ marginBottom: 48 }}>
      <SectionEyebrow>The principle</SectionEyebrow>
      <SectionHeading>
        We give you probabilities
        <span style={{ color: "var(--amber)" }}>,</span> not predictions.
      </SectionHeading>
      <EditorialP>
        When Prophiq says "60% Verstappen wins Monaco," it is not predicting
        that Verstappen wins. It is saying:{" "}
        <Em>more likely than not, but far from certain.</Em> The right way to
        read a probability isn't "will this happen?" - it's "how confident
        should I be?"
      </EditorialP>
      <EditorialP>
        This makes <Em>calibration</Em> matter more than hit rate. A perfectly
        calibrated forecaster who says 60% should be right 60% of the time -
        and wrong 40% of the time, by design. Those misses aren't failures.
        They're the math working as intended.
      </EditorialP>
    </section>
  );
}

function ProbabilityKeySection() {
  return (
    <section style={{ marginBottom: 48 }}>
      <SectionEyebrow>Reading the percentage</SectionEyebrow>
      <SectionHeading>What the numbers mean.</SectionHeading>
      <EditorialP>
        A probability is a measurement of confidence, not a prediction of
        outcome. Here's how to read them:
      </EditorialP>
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          padding: 20,
          marginTop: 20,
        }}
      >
        {PROB_KEY.map((row, i) => (
          <div
            key={row.range}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "10px 0",
              borderBottom:
                i < PROB_KEY.length - 1 ? "1px solid var(--line)" : undefined,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--amber-2)",
                letterSpacing: "0.04em",
                minWidth: 56,
              }}
            >
              {row.range}
            </div>
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 13.5,
                lineHeight: 1.4,
                color: "var(--ink-soft)",
                letterSpacing: "-0.005em",
              }}
            >
              {row.meaning}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentCallsSection() {
  return (
    <section style={{ marginBottom: 48 }}>
      <SectionEyebrow>Recent calls</SectionEyebrow>
      <SectionHeading>How it's played out.</SectionHeading>
      <EditorialP>Recent forecasts and how they resolved.</EditorialP>
      <div style={{ marginTop: 20 }}>
        {FEATURED_CALLS.map((call) => (
          <FeaturedCallCard key={call.id} call={call} />
        ))}
      </div>
    </section>
  );
}

function FeaturedCallCard({ call }: { call: FeaturedCall }) {
  const renderTakeaway = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} style={{ color: "var(--ink)", fontWeight: 600 }}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: 20,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          marginBottom: 10,
        }}
      >
        <span>{call.domain}</span>
        <span
          style={{
            width: 3,
            height: 3,
            background: "var(--ink-faint)",
            borderRadius: "50%",
            opacity: 0.6,
          }}
        />
        <span
          style={{
            color:
              call.outcome === "landed" ? "var(--green)" : "var(--ink-soft)",
            fontWeight: 700,
          }}
        >
          {call.outcome === "landed" ? "Landed" : "Did not land"}
        </span>
      </div>

      <div
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 600,
          fontSize: 16,
          lineHeight: 1.3,
          color: "var(--ink)",
          letterSpacing: "-0.02em",
          marginBottom: 14,
        }}
      >
        {call.question}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 16,
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
            }}
          >
            Our call
          </span>
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 700,
              fontSize: 20,
              color: "var(--amber)",
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            {call.prophiqCallPct}%
          </span>
        </div>
        <span
          style={{
            color: "var(--ink-faint)",
            fontSize: 14,
            alignSelf: "center",
          }}
        >
          →
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
            }}
          >
            Outcome
          </span>
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 700,
              fontSize: 20,
              color:
                call.outcome === "landed" ? "var(--ink)" : "var(--ink-faint)",
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            {call.outcomeLabel}
          </span>
        </div>
      </div>

      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--ink-soft)",
          letterSpacing: "-0.005em",
          paddingTop: 14,
          borderTop: "1px solid var(--line)",
        }}
      >
        {renderTakeaway(call.takeaway)}
      </p>
    </div>
  );
}

function AggregateSection() {
  return (
    <section style={{ marginBottom: 48 }}>
      <SectionEyebrow>The big picture</SectionEyebrow>
      <SectionHeading>
        How calibrated are we
        <span style={{ color: "var(--amber)" }}>?</span>
      </SectionHeading>
      <EditorialP>
        Across our resolved forecasts:
      </EditorialP>
      <div
        style={{
          background: "var(--bg-tint)",
          border: "1px solid rgba(244, 115, 26, 0.2)",
          borderRadius: 16,
          padding: "24px 20px",
          marginTop: 20,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontWeight: 700,
            fontSize: 32,
            letterSpacing: "-0.03em",
            color: "var(--ink)",
            lineHeight: 1,
            marginBottom: 8,
          }}
        >
          {AGGREGATE.resolvedCount}{" "}
          <span style={{ color: "var(--amber)" }}>resolved</span>
        </div>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13.5,
            lineHeight: 1.5,
            color: "var(--ink-soft)",
            letterSpacing: "-0.005em",
          }}
        >
          When Prophiq said something had a given probability, on average it
          landed within{" "}
          <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
            {AGGREGATE.avgCalibrationErrorPp} percentage points
          </strong>{" "}
          of that - across all four domains. Updated monthly.
        </p>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <div
      style={{
        textAlign: "center",
        paddingTop: 32,
        borderTop: "1px solid var(--line)",
        marginTop: 16,
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
