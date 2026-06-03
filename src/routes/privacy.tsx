import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { getPublicBaseUrl } from "@/lib/publicUrl";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy - prophiq." },
      {
        name: "description",
        content:
          "How Prophiq handles your data - what we collect, how we use it, and the rights you have over it.",
      },
      { property: "og:title", content: "Privacy - prophiq." },
      {
        property: "og:description",
        content:
          "How Prophiq handles your data - what we collect, how we use it, and the rights you have over it.",
      },
    ],
    links: [
      {
        rel: "canonical",
        href: `${getPublicBaseUrl()}/privacy`,
      },
    ],
  }),
  component: PrivacyPage,
});

const LAST_UPDATED = "3 June 2026";
const CONTACT_EMAIL = "privacy@prophiq.io";

// ============================================================
// PAGE
// ============================================================

function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 pb-16 pt-8">
      <Hero />

      <Section eyebrow="The basics" heading="Who we are and what this covers">
        <EditorialP>
          Prophiq is a calibrated probabilistic forecasting service operated
          from the United Kingdom and accessible at prophiq.io. This policy
          explains how we handle personal data when you visit or interact with
          the service.
        </EditorialP>
        <EditorialP>
          We are the <Em>data controller</Em> under UK GDPR for the data
          described here. By using Prophiq, you accept the practices set out
          in this policy.
        </EditorialP>
      </Section>

      <Section eyebrow="What we collect" heading="The data we hold">
        <EditorialP>
          We collect the minimum data needed to operate the service and
          improve calibration over time. Specifically:
        </EditorialP>
        <ItemList
          items={[
            {
              term: "Submitted questions",
              detail:
                "The text of any question you submit through the Ask feature, along with the resulting forecast.",
            },
            {
              term: "Hashed IP addresses",
              detail:
                "Used for rate limiting and abuse prevention. Stored as a one-way hash, never the raw address.",
            },
            {
              term: "Browser metadata",
              detail:
                "Standard request headers - user agent, language, referrer - used for security and aggregate analytics.",
            },
            {
              term: "Local browser storage",
              detail:
                "Your recent questions and search history are stored locally in your browser. They do not leave your device unless you submit them.",
            },
          ]}
        />
      </Section>

      <Section eyebrow="Why we collect it" heading="Our lawful basis">
        <EditorialP>
          We process the data above for the following purposes, with the
          listed legal basis under UK GDPR:
        </EditorialP>
        <ItemList
          items={[
            {
              term: "Operating the service",
              detail:
                "Generating forecasts in response to your questions. Legal basis: performance of a contract / legitimate interests.",
            },
            {
              term: "Security and abuse prevention",
              detail:
                "Rate limiting, fraud detection, and protecting the integrity of the service. Legal basis: legitimate interests.",
            },
            {
              term: "Improving calibration",
              detail:
                "Folding resolved forecasts back into the system to sharpen accuracy over time. Legal basis: legitimate interests.",
            },
            {
              term: "Aggregate analytics",
              detail:
                "Understanding usage patterns in anonymised form. Legal basis: legitimate interests.",
            },
          ]}
        />
      </Section>

      <Section eyebrow="Who we work with" heading="Our data processors">
        <EditorialP>
          Prophiq runs on a small set of third-party services. Each is a data
          processor acting under our instructions. We use them because they
          are core to operating the service.
        </EditorialP>
        <ItemList
          items={[
            {
              term: "Anthropic",
              detail:
                "Receives question text and research context to generate forecasts as part of the reasoning ensemble.",
            },
            {
              term: "OpenAI",
              detail:
                "Receives question text and research context to generate forecasts as part of the reasoning ensemble.",
            },
            {
              term: "Google",
              detail:
                "Receives question text and research context to generate forecasts as part of the reasoning ensemble.",
            },
            {
              term: "Perplexity",
              detail:
                "Used to retrieve real-time research context for each forecast.",
            },
            {
              term: "Supabase",
              detail:
                "Hosts our database and backend infrastructure. Stores forecasts, calibration data, and operational logs.",
            },
            {
              term: "Cloudflare",
              detail:
                "Edge network, hosting, and DDoS protection. Sees request metadata in transit.",
            },
          ]}
        />
        <EditorialP>
          We <Em>do not sell your data</Em>. We do not share it with
          advertisers or data brokers. Where data is transferred outside the
          UK or EEA, transfers are governed by Standard Contractual Clauses
          or equivalent safeguards.
        </EditorialP>
      </Section>

      <Section eyebrow="Your rights" heading="What you can ask us to do">
        <EditorialP>
          Under UK GDPR, you have the following rights over personal data we
          hold about you:
        </EditorialP>
        <ItemList
          items={[
            {
              term: "Right of access",
              detail:
                "Ask us for a copy of the personal data we hold about you.",
            },
            {
              term: "Right to rectification",
              detail: "Ask us to correct data that is inaccurate or incomplete.",
            },
            {
              term: "Right to erasure",
              detail:
                "Ask us to delete data we hold about you, subject to legal retention requirements.",
            },
            {
              term: "Right to restrict processing",
              detail:
                "Ask us to limit how we process your data while a query is resolved.",
            },
            {
              term: "Right to object",
              detail:
                "Object to processing based on our legitimate interests.",
            },
            {
              term: "Right to lodge a complaint",
              detail:
                "Complain to the UK Information Commissioner's Office (ICO) at ico.org.uk.",
            },
          ]}
        />
        <EditorialP>
          To exercise any of these rights, contact us at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            style={{ color: "var(--amber)", textDecoration: "none", fontWeight: 500 }}
          >
            {CONTACT_EMAIL}
          </a>
          . We respond within 30 days.
        </EditorialP>
      </Section>

      <Section eyebrow="How long we keep it" heading="Retention periods">
        <ItemList
          items={[
            {
              term: "Submitted questions and forecasts",
              detail:
                "Retained indefinitely - they form part of the calibration record.",
            },
            {
              term: "Hashed IP addresses",
              detail: "Retained for 30 days, then deleted.",
            },
            {
              term: "Aggregate analytics",
              detail: "Retained for 24 months in anonymised form.",
            },
            {
              term: "Operational logs",
              detail: "Retained for 90 days for security and debugging.",
            },
          ]}
        />
      </Section>

      <Section eyebrow="Storage and security" heading="Where data lives">
        <EditorialP>
          Data is stored in EU or UK data centres where the provider supports
          regional deployment. Data is encrypted at rest and in transit.
          Access to production data is restricted, logged, and monitored.
        </EditorialP>
        <EditorialP>
          Where data is transferred outside the UK or EEA - for example, when
          a question is sent to an AI processor whose servers are located in
          the US - transfers rely on Standard Contractual Clauses, adequacy
          decisions, or other safeguards permitted by UK GDPR.
        </EditorialP>
      </Section>

      <Section eyebrow="Children" heading="Not for under 18s">
        <EditorialP>
          Prophiq is not directed at children under 18. We do not knowingly
          collect personal data from minors. If you believe a child has
          submitted data to us, contact us and we will delete it.
        </EditorialP>
      </Section>

      <Section eyebrow="Changes" heading="Updates to this policy">
        <EditorialP>
          We may update this policy from time to time. The "last updated"
          date at the top of this page will change. Material changes will be
          flagged with a notice on the site before they take effect.
        </EditorialP>
      </Section>

      <Section eyebrow="Contact" heading="Get in touch">
        <EditorialP>
          For any privacy-related question or to exercise your rights, email{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            style={{ color: "var(--amber)", textDecoration: "none", fontWeight: 500 }}
          >
            {CONTACT_EMAIL}
          </a>
          .
        </EditorialP>
      </Section>

      <CrossLink to="/terms" label="See our terms →" />
    </main>
  );
}

// ============================================================
// PAGE PRIMITIVES (local to this file; mirrored in terms.tsx)
// ============================================================

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
        Privacy<span style={{ color: "var(--amber)" }}>.</span>
      </h1>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 15,
          lineHeight: 1.5,
          color: "var(--ink-soft)",
          maxWidth: "34ch",
          letterSpacing: "-0.005em",
          marginBottom: 10,
        }}
      >
        How we handle your data - plainly, and in full.
      </p>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        Last updated: {LAST_UPDATED}
      </div>
    </header>
  );
}

function Section({
  eyebrow,
  heading,
  children,
}: {
  eyebrow: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <section style={{ marginBottom: 48 }}>
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
        {eyebrow}
      </div>
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
        {heading}
      </h2>
      {children}
    </section>
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

function ItemList({
  items,
}: {
  items: Array<{ term: string; detail: string }>;
}) {
  return (
    <dl style={{ marginTop: 8, marginBottom: 20 }}>
      {items.map((item, i) => (
        <div
          key={item.term}
          style={{
            padding: "14px 0",
            borderTop: "1px solid var(--line)",
            borderBottom:
              i === items.length - 1 ? "1px solid var(--line)" : undefined,
          }}
        >
          <dt
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              fontSize: 14.5,
              color: "var(--ink)",
              letterSpacing: "-0.015em",
              marginBottom: 4,
            }}
          >
            {item.term}
          </dt>
          <dd
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 13.5,
              lineHeight: 1.5,
              color: "var(--ink-soft)",
              letterSpacing: "-0.005em",
              margin: 0,
            }}
          >
            {item.detail}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CrossLink({
  to,
  label,
}: {
  to: "/privacy" | "/terms";
  label: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        paddingTop: 32,
        borderTop: "1px solid var(--line)",
        marginTop: 16,
      }}
    >
      <Link
        to={to}
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--amber)",
          textDecoration: "none",
          letterSpacing: "-0.01em",
        }}
      >
        {label}
      </Link>
    </div>
  );
}
