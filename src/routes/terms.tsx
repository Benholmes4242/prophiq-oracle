import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { getPublicBaseUrl } from "@/lib/publicUrl";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms - prophiq." },
      {
        name: "description",
        content:
          "The terms governing your use of Prophiq. Informational forecasts only - not financial, legal, or betting advice.",
      },
      { property: "og:title", content: "Terms - prophiq." },
      {
        property: "og:description",
        content:
          "The terms governing your use of Prophiq. Informational forecasts only - not financial, legal, or betting advice.",
      },
    ],
    links: [
      {
        rel: "canonical",
        href: `${getPublicBaseUrl()}/terms`,
      },
    ],
  }),
  component: TermsPage,
});

const LAST_UPDATED = "3 June 2026";
const CONTACT_EMAIL = "legal@prophiq.io";

// ============================================================
// PAGE
// ============================================================

function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 pb-16 pt-8">
      <Hero />

      <Section eyebrow="The basics" heading="Accepting these terms">
        <EditorialP>
          By accessing or using Prophiq, you agree to these terms. If you do
          not agree, please do not use the service. These terms form a legal
          agreement between you and Prophiq.
        </EditorialP>
        <EditorialP>
          We may update these terms from time to time. Continued use of the
          service after an update constitutes acceptance of the revised
          terms.
        </EditorialP>
      </Section>

      <Section eyebrow="About Prophiq" heading="What the service is">
        <EditorialP>
          Prophiq is a calibrated probabilistic forecasting service operating
          across four domains: sport, politics, markets, and entertainment.
          Forecasts are produced by Prophiq's reasoning pipeline - a
          multi-stage system that combines real-time research with an
          ensemble of frontier reasoning systems and a proprietary consensus
          engine.
        </EditorialP>
        <EditorialP>
          Prophiq is accessible at prophiq.io. Access is free at the time of
          these terms, subject to fair use and rate limits. Some content may
          be restricted in certain jurisdictions.
        </EditorialP>
      </Section>

      <Section eyebrow="What this isn't" heading="Important disclaimers">
        <EditorialP>
          <Em>
            Prophiq provides informational forecasts. It does not provide
            advice of any kind.
          </Em>{" "}
          You should not rely on Prophiq as a sole basis for any decision.
        </EditorialP>
        <ItemList
          items={[
            {
              term: "Not financial advice",
              detail:
                "Markets-related forecasts are informational only. Nothing on Prophiq constitutes investment advice, a recommendation to buy or sell any security, or a solicitation of any kind. Consult a regulated financial adviser for investment decisions.",
            },
            {
              term: "Not a betting or gambling product",
              detail:
                "Sport and event-related forecasts are not betting tips, odds, or recommendations to wager. Prophiq does not facilitate gambling and takes no position on the legality of gambling in your jurisdiction.",
            },
            {
              term: "Not political endorsement",
              detail:
                "Politics-related forecasts are non-partisan probability estimates. They are not endorsements of any candidate, party, or political position.",
            },
            {
              term: "Not legal, medical, or professional advice",
              detail:
                "Nothing on Prophiq constitutes legal, medical, tax, or other professional advice. Consult an appropriately qualified professional for advice in those domains.",
            },
            {
              term: "Past performance is not a guarantee",
              detail:
                "Prophiq's calibration record reflects historical accuracy on resolved events. It is not a forward-looking guarantee of future accuracy on any specific forecast.",
            },
          ]}
        />
      </Section>

      <Section eyebrow="Age" heading="You must be 18 or older">
        <EditorialP>
          You must be at least 18 years old to use Prophiq. Some content -
          particularly markets forecasts and sport-adjacent content - is
          subject to age and licensing restrictions in various jurisdictions.
          You are responsible for ensuring your use of the service complies
          with the laws of your jurisdiction.
        </EditorialP>
      </Section>

      <Section eyebrow="Using Prophiq" heading="Acceptable use">
        <EditorialP>
          You agree to use Prophiq lawfully and in good faith. The following
          are prohibited:
        </EditorialP>
        <ItemList
          items={[
            {
              term: "Abuse of the service",
              detail:
                "Spam, harassment, attempts to circumvent rate limits, or any use that interferes with the operation of the service.",
            },
            {
              term: "Scraping for resale",
              detail:
                "Automated extraction of forecasts, calibration data, or other content for commercial redistribution without our written permission.",
            },
            {
              term: "Reverse engineering",
              detail:
                "Attempts to reverse engineer, decompile, or otherwise probe the reasoning pipeline or consensus engine.",
            },
            {
              term: "Submitting harmful content",
              detail:
                "Questions or input designed to elicit unlawful, harmful, defamatory, or otherwise objectionable output.",
            },
            {
              term: "Personally identifying information",
              detail:
                "Do not submit personal data about yourself or third parties through the Ask feature. Submitted questions may be retained and surfaced publicly in anonymised form.",
            },
          ]}
        />
      </Section>

      <Section
        eyebrow="What's yours and what's ours"
        heading="Intellectual property"
      >
        <EditorialP>
          <Em>Prophiq retains all rights to:</Em> the platform, the
          forecasting methodology, the consensus engine, the calibration
          record, the Prophiq name and wordmark, and all content and copy
          published on the site.
        </EditorialP>
        <EditorialP>
          <Em>You retain rights to questions you submit</Em> through the Ask
          feature. By submitting a question, you grant Prophiq a
          non-exclusive, worldwide, royalty-free licence to process it,
          generate a forecast in response, and include the question and its
          outcome in Prophiq's calibration record. Where questions or
          forecasts are surfaced publicly, they may be anonymised or
          aggregated.
        </EditorialP>
      </Section>

      <Section eyebrow="Accuracy" heading="Probabilities, not predictions">
        <EditorialP>
          Prophiq produces probabilistic estimates. A probability is not a
          prediction of certainty. A 60% forecast means we estimate the
          outcome will occur roughly 60% of the time across many similar
          situations - it does not mean the outcome will definitely occur.
        </EditorialP>
        <EditorialP>
          Real-world events resolve in ways that probability alone cannot
          determine. Prophiq's calibration record reflects historical
          accuracy on resolved events; it is not a forward-looking guarantee.
          You accept that reliance on Prophiq's forecasts is at your own
          risk.
        </EditorialP>
      </Section>

      <Section eyebrow="Limits" heading="Limitation of liability">
        <EditorialP>
          Prophiq is provided <Em>"as is"</Em> and <Em>"as available"</Em>{" "}
          without warranties of any kind, express or implied, except as
          required by applicable law.
        </EditorialP>
        <EditorialP>
          To the maximum extent permitted by law, Prophiq, its operators,
          contractors, and service providers will not be liable for:
        </EditorialP>
        <ItemList
          items={[
            {
              term: "Financial loss",
              detail:
                "Any loss arising from investment, trading, or other financial decisions made in reliance on Prophiq's forecasts.",
            },
            {
              term: "Wagering loss",
              detail:
                "Any loss arising from betting, gambling, or wagering decisions made in reliance on Prophiq's forecasts.",
            },
            {
              term: "Indirect or consequential loss",
              detail:
                "Loss of profit, loss of opportunity, loss of data, or other indirect or consequential damages of any kind.",
            },
            {
              term: "Service interruption",
              detail:
                "Downtime, errors, or unavailability of the service, including loss of access to historical forecasts.",
            },
          ]}
        />
        <EditorialP>
          Nothing in these terms excludes or limits liability for death or
          personal injury caused by negligence, for fraud or fraudulent
          misrepresentation, or for any other liability that cannot lawfully
          be excluded or limited under English law.
        </EditorialP>
      </Section>

      <Section eyebrow="Termination" heading="Ending access">
        <EditorialP>
          We may suspend or terminate your access to Prophiq at any time if
          you breach these terms or if we reasonably believe your use of the
          service threatens its integrity, security, or other users. You may
          stop using Prophiq at any time. Sections covering intellectual
          property, limitation of liability, and governing law survive
          termination.
        </EditorialP>
      </Section>

      <Section eyebrow="Changes" heading="Updates to these terms">
        <EditorialP>
          We may revise these terms from time to time. The "last updated"
          date at the top of this page will change. Material changes will be
          flagged with a notice on the site before they take effect.
          Continued use after the effective date of revised terms constitutes
          acceptance.
        </EditorialP>
      </Section>

      <Section eyebrow="Law" heading="Governing law and jurisdiction">
        <EditorialP>
          These terms are governed by the laws of England and Wales. Any
          dispute arising out of or in connection with these terms or your
          use of Prophiq is subject to the exclusive jurisdiction of the
          courts of England.
        </EditorialP>
      </Section>

      <Section eyebrow="Contact" heading="Get in touch">
        <EditorialP>
          For any question about these terms, email{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            style={{ color: "var(--amber)", textDecoration: "none", fontWeight: 500 }}
          >
            {CONTACT_EMAIL}
          </a>
          .
        </EditorialP>
      </Section>

      <CrossLink to="/privacy" label="See our privacy policy →" />
    </main>
  );
}

// ============================================================
// PAGE PRIMITIVES (local to this file; mirrored in privacy.tsx)
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
        Terms<span style={{ color: "var(--amber)" }}>.</span>
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
        The rules of using Prophiq. Plain English where possible.
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
